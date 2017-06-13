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

```
let ClientIpcRpc = require("arc-rpc").ClientIpcRpc

let rpc = null

class ClientClass {
	clientTest() {
		console.log("Remotely called by server, calling server method.")
		let server = rpc.genClass()
		await server.serverTest()
		console.log("Called remote server method!")
	}
}

rpc = new ClientIpcRpc ("testing", Buffer.from ('flbd+mTz8bIWl2DQxFMKHYAA1+PFxpEKmVNsZpFP5xQ=', 'base64'), new ClientClass())
```

`Client.js`

```
let ServerIpcRpcMaster = require("arc-rpc").ServerIpcRpcMaster

class ServerClass {
	serverTest() {
		console.log("Remotely called by client.")
	}
}

let rpcMaster = new ServerIpcRpcMaster ("testing", Buffer.from ('flbd+mTz8bIWl2DQxFMKHYAA1+PFxpEKmVNsZpFP5xQ=', 'base64'), new ServerClass())

rpcMaster.on("client", (clientRpc) => {
	console.log("Got new client, remotely calling client test.")
	let client = clientRpc.genClass()
	await client.clientTest()
	console.log("Remotely called client test!")
})
```

## Basic documentation

I'll get to completing this later