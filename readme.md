NPM package for ChatGPT & GPT 4 that handles rate limiting, concurrency, timeouts and response validation.


&nbsp;


```javascript
const prompt = require('prompt-gpt')({
	model: 'gpt-3.5-turbo',
	apiKey: process.env.apiKey,
	rateLimit: 60,
	concurrency: 5,
	timeout: 5000,
});
```
You can initialize the package with GPT 3.5 or 4 and optionally configure a rateLimit, concurrency & timeout.


&nbsp;


```javascript
for(let i = 0; i < 120; i++){
	prompt({
		message: `Return a javascript array of ${i + 3} animal names`,
		pass: function(response){
			console.log(response);
		}
	});
}
await prompt.evaluate();
```
Prompts are generated ahead of time with the evaluate call halting the program while they are processed.


&nbsp;


```javascript
for(let i = 0; i < 120; i++){
	prompt({
		i: i,
		message: `Return a javascript array of ${i + 3} animal names`,
		pass: function(response){
			console.log("SUCCESS", this.i);
		},
		validate: function(text){
			text = text.trim();
			return text[0] === '[';
		}
	});
}
await prompt.evaluate();
```
The program defaults to user input validation, however a validate function can be added to programmatically validate the responses.