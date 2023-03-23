const https = require('https');
const prompt = require('prompt-sync')();
const colors = require('colors/safe.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const timeout = (prom, time) =>
	Promise.race([prom, new Promise((_r, rej) => setTimeout(rej, time))]);

let config = {
	model: 'gpt-3.5-turbo',
	apiKey: false,
	rateLimit: 60, // per minute
	concurrency: 5,
	timeout: 30 * 1000
};

const rateLimitMs = 60 * 1000;
const rateLimitMs1 = rateLimitMs + 1;

async function request(model, prompt, headers, timeoutValue, config) {
	if (config === undefined) config = {};

	const data = {
		model: model,
		messages: [{ role: 'user', content: prompt }]
	};

	return new Promise((resolve, reject) => {
		const options = {
			hostname: 'api.openai.com',
			path: '/v1/chat/completions',
			port: 443,
			method: 'POST',
			headers: headers,
			timeout: timeoutValue
		};

		const req = https.request(options, (res) => res.on('data', (d) => resolve({ status: res.statusCode, data: JSON.parse(d) })));

		req.on('error', (error) => reject(error));

		req.setTimeout(options.timeout, () => {
			req.abort();
			reject();
		});

		req.write(JSON.stringify(data));
		req.end();
	});
}

async function timedRequest(promptThis, stringInput, arrayIndex, timeoutValue = 5000) {
	return request(promptThis.config.model, stringInput.message, promptThis.headers, timeoutValue, promptThis.config.config).then(value => {
		return {
			text: stringInput.message,
			status: value.status,
			message: value.data.choices[0].message,
			tokens: value.data.usage.total_tokens,
			arrayIndex,
		}
	}).catch((err) => {
		if (err === undefined) {
			return {
				text: stringInput.message,
				status: 408,
				arrayIndex
			}
		}
		console.log("THE UNHANDLED ERROR:");
		console.log(err);
		console.log(err.response.data);
		return {
			text: stringInput.message,
			status: 500,
			arrayIndex
		}
	})
}

module.exports = function (inputConfig) {
	let newConfig = JSON.parse(JSON.stringify(config));
	for (const key in inputConfig) newConfig[key] = inputConfig[key];

	if (newConfig.apiKey === false) throw new Error("No OpenAI API key provided.");

	let promptThis = {
		total_tokens: 0,
		calls: [],
		inputs: [],
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${newConfig.apiKey}`
		},
		config: newConfig,
	}

	let promptFunction = function (text) {
		this.inputs.push(text);
	}.bind(promptThis);

	promptFunction.config = promptThis.config;

	promptFunction.evaluate = async function () {
		// Get our current remaining rate limit
		let rateLimit = this.config.rateLimit;
		let oldestTimestamp = 0;

		// Eliminate calls that were more than a minute ago
		// Calculate the remaining rate & token limit & the oldest timestamp
		for (let a = 0; a < this.calls.length; a++) {
			if (this.calls[a].timestamp < Date.now() - rateLimitMs) {
				this.calls.splice(a, 1);
				a--;
			} else {
				if (oldestTimestamp == 0 || this.calls[a].timestamp < oldestTimestamp) oldestTimestamp = this.calls[a].timestamp;
				rateLimit -= this.calls[a].calls;
			}
		}

		// Make the requests now
		const relativeRateLimit = Math.min(Math.min(rateLimit, this.config.concurrency), this.inputs.length);
		const requestPromises = [];
		if (0 < relativeRateLimit) console.log(colors.green("\nThe requests:\n"));
		for (let a = 0; a < relativeRateLimit; a++) {
			const stringInput = this.inputs[a];
			console.log(stringInput.message + "\n");

			requestPromises.push(timedRequest(this, stringInput, a, this.config.timeout));
		}
		await Promise.all(requestPromises).then((values) => {
			let totalSpliced = 0;
			let problemValues = [];

			// Prompt the user for each successful value
			for (const value of values) {
				if(value === undefined) continue;
				if (value.tokens) this.total_tokens += value.tokens;

				// If the request was successful, remove the string from the array
				if (value.status === 200) {
					const targetInput = this.inputs[value.arrayIndex - totalSpliced];

					// If the input has a validation function
					let wasResponseValid;
					if (targetInput.validate) {
						wasResponseValid = targetInput.validate(value.message.content);
					} else {
						// Prompt the user with the response
						console.clear();
						console.log(colors.cyan(`(${this.total_tokens} consumed)\n`));
						console.log(colors.green("The prompt:\n"));
						console.log(value.text);
						console.log(colors.yellow("\n\n\nThe model return:"));
						console.log(value.message.content);
						console.log(colors.red("\n\n\nAccept?"));
						const userInput = prompt('\n(enter=yes, anything=no):');

						if (userInput === null) process.exit(0);
						// If the user input is enter, splice
						if (userInput.length === 0) wasResponseValid = true;
					}
					if (wasResponseValid) {
						this.inputs.splice(value.arrayIndex - totalSpliced, 1)
						totalSpliced++;

						if (targetInput.pass) {
							delete value.arrayIndex;
							value.total_tokens = this.total_tokens;
							targetInput.pass(value);
						}
					}
					console.log();
				} else problemValues.push(value);
			}
			// Print out the problematic values
			for (const value of problemValues) {
				if (value.status === 408) console.log(colors.red("Timed out for request"), colors.magenta(`'${value.text}'`));
				else {
					console.log("THE UNHANDLED VALUE: ");
					console.log(value);
				}
			}
			console.log();
			// Register the calls
			this.calls.push({
				timestamp: Date.now(),
				calls: values.length
			})
		})

		// Check what the limiting condition is
		if (this.inputs.length === 0) return;

		// Sleep if we're rate limited
		if (relativeRateLimit === rateLimit) {
			const timeDiff = new Date().getTime() - oldestTimestamp;
			const sleepTime = rateLimitMs1 - timeDiff;
			console.log(`Sleeping for ${sleepTime} until rate limit updates`);
			await sleep(sleepTime);
		}

		// Loop back through the function
		await this.evaluate();

	}.bind(promptThis);
	promptThis.evaluate = promptFunction.evaluate;

	return promptFunction;
}