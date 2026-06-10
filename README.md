# openclawlite

### Chapter-1 :- Project Init
-> just initialized the project using bun init and some tsconfig rules


### Chapter-2 :- CLI tools
-> some cli tools we'll be using :- 
1) commander
2) clack 
3) figlet-js (for large banners which comes on running a command)
4) chalk (for colouring the commands)

-> setup the commander cli and do bun link

--
?doubt: what is bun link ?
--

-> #!/usr/bin/env bun : this is shebang

--
?doubt: what is shebang ?
--

-> because of shebang, we use `openclawlite wakeup` instead of `bun index.ts wakeup`, remember both works but first one is a good practice


-> what is "bin" in package.json 

"bin": {
    "openclawlite": "./index.ts"
}

-> this means that create a terminal command named `openclawlite` and when someone runs it, execute ./index.ts file

--
?dount: know how shebang and this works together ?
--

-> what does bun link do ?
-> `bun link` commands tell bun to register the project globally as a CLI tool. so now we can create a fresh new terminal and use this command there
-> without link, we can only use the CLI command inside the project only, not in a fresh terminal globally

-> replace the console.log("wakeup") with a wakeup function

-> add banner and cli and telegram mode functionalities



### Chapter-3 :- enhacing the CLI tool

-> adding exit and more options like Agent, ask, plan modes

--
?doubt: why await the select options in the cli if this is purely a cli project ?
--

### Chapter-4 :- ai config and implementing agent mode (AI SDK)

