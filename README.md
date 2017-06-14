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

Here is a basic example of using RPC with `node-ipc`

`Server.js`

```js
// Include library for IPC-RPC clients
let ClientIpcRpc = require("arc-rpc").ClientIpcRpc

// Define `serverIpc` in higher scope for testing purposes
let serverRpc = null

// Example remotely-callable class (this can be anything)
class ClientClass {
	// Example method
	clientTest() {
		console.log("Remotely called by server, calling server method.")

		// Call remote as if it was a local class instance
		await rpc.class.serverTest()

		// This is garuanteed to be afterwards, as ES7 awaits are used
		console.log("Called remote server method!")
	}
}

// Create RPC to server, on IPC channel testing, predefined encryption key, with an instance of the example client class
serverRpc = new ClientIpcRpc ("testing", Buffer.from ('flbd+mTz8bIWl2DQxFMKHYAA1+PFxpEKmVNsZpFP5xQ=', 'base64'), new ClientClass())
```

`Client.js`

```js
// Include library for IPC-RPC servers
let ServerIpcRpcMaster = require("arc-rpc").ServerIpcRpcMaster


// Example remotely-callable class (this can be anything)
class ServerClass {
	serverTest() {
		console.log("Remotely called by client.")
	}
}

// Create RPC master/listener, on IPC channel testing, predefined encryption key, with an instance of the example server class
let rpcMaster = new ServerIpcRpcMaster ("testing", Buffer.from ('flbd+mTz8bIWl2DQxFMKHYAA1+PFxpEKmVNsZpFP5xQ=', 'base64'), new ServerClass())

// Listen for new clients
rpcMaster.on("client", (clientRpc) => {
	console.log("Got new client, remotely calling client test.")

	// Call remote as if it was a local class instance
	await clientRpc.class.clientTest()
	
	// This is garuanteed to be afterwards, as ES7 awaits are used
	console.log("Remotely called client test!")
})
```

## Basic documentation

I'll get to completing this later