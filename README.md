# Arc RPC
###### Asynchronous Remote Classes make RPC simple

---

## How does it work
Arc RPC allows you to remotely call functions on other processes or even other hardware using these few main concepts

- Ability to wrap existing class instances
- Mock that acts like the remote class
- Bi-directional
- Protocol agnostic

## How to use it

Here is a basic example of using RPC with `socket.io`

`Server.js`

```js
// Include library for socket RPC clients
let ClientSocketRpc = require("arc-rpc").ClientSocketRpc

// Define `serverRpc` in higher scope for testing purposes
let serverRpc = null

// Example remotely-callable class (this can be anything)
class ClientClass {
	// Example method
	async clientTest() {
		console.log("Remotely called by server, calling server method.")

		// Call remote as if it was a local class instance
		await rpc.class.serverTest()

		// This is garuanteed to be afterwards, as ES7 awaits are used
		console.log("Called remote server method!")
	}
}

// Create RPC to server over socket.io socket, predefined encryption key, with an instance of the example client class
serverRpc = new ClientSocketRpc ("127.0.0.1", 9919, Buffer.from ('flbd+mTz8bIWl2DQxFMKHYAA1+PFxpEKmVNsZpFP5xQ=', 'base64'), new ClientClass())
```

`Client.js`

```js
// Include library for socket RPC servers
let ServerSocketRpcMaster = require("arc-rpc").ServerSocketRpcMaster


// Example remotely-callable class (this can be anything)
class ServerClass {
	async serverTest() {
		console.log("Remotely called by client.")
	}
}

// Create RPC master/listener, on socket.io connection, predefined encryption key, with an instance of the example server class
let rpcMaster = new ServerSocketRpcMaster (9919, Buffer.from ('flbd+mTz8bIWl2DQxFMKHYAA1+PFxpEKmVNsZpFP5xQ=', 'base64'), new ServerClass())

// Listen for new clients
rpcMaster.on("client", async (clientRpc) => {
	console.log("Got new client, remotely calling client test.")

	// Call remote as if it was a local class instance
	await clientRpc.class.clientTest()

	// This is garuanteed to be afterwards, as ES7 awaits are used
	console.log("Remotely called client test!")
})
```

## Basic documentation

I'll get to completing this later