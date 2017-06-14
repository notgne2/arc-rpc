'use strict'; // always strict mode

// Import dependencies
const EventEmitter = require ('events').EventEmitter;
const uuid         = require ('uuid');
const ipc          = require ('node-ipc');
const nacl         = require ('tweetnacl');

// Create general RPC class
class Rpc extends EventEmitter {
	constructor (stream, child) {
		// Induce spawning of parent/super event emitter
		super ();

		// Set own ID for identification
		this.id = uuid ();

		// Set mock for accessing methods
		this.class = this._genClass ();

		// Set private variables
		this._stream = stream;
		this._child = child;

		// Listen for events
		this._listen ();
	}

	send (id, ...params) {
		// Emit event to remote
		this._stream.send ('evt', {
			params : params,
			id     : id,
		});
	}

	_genClass () {
		// Create handler for proxy class
		let proxyHandler = {
			// Handle get on proxy class
			get: (target, property) => {
				// Return function which takes all trailing params
				return (async (...params) => {
					// Issue remote call with property name and recieved params
					let result = await this._call (property, params);

					// Check if response is error
					if (result.isError) {
						// Throw if error to emulate native function
						throw result.data;
					} else {
						// Non error, simply return data
						return result.data;
					}
				});
			},
		};

		// Create a new `Proxy` to act as our class
		let proxy = new Proxy ({}, proxyHandler);

		// Return the proxy
		return proxy;
	}

	_listen () {
		// Listen for function calls
		this._stream.on ('fnCall', async (call) => {
			// Create response variable on higher scope
			let response = null;

			// Find internal handler, TODO: handle missing
			let handler = this._child[call.fnId];

			// Try getting response from handler or handle error
			try {
				// Run with applied params and await result
				response = await handler (...call.params);
			} catch (err) {
				// Emit error as response
				this._stream.send ('fnRes.' + call.resId, {
					isError: true,
					data: err,
				});
			}

			// Emit success and function return result
			this._stream.send ('fnRes.' + call.resId, {
				isError: false,
				data: response,
			});
		});

		// Listen for remote user events
		this._stream.on ('evt', (data) => {
			// Rebroadcast to listeners on self
			this.emit ('event.' + data.id, ...data.params);
		});
	}

	async _call (fnId, params) {
		// Generate ID to listen for responses on
		let resId = uuid ();

		// Emit the remote call event
		this._stream.send ('fnCall', {
			fnId: fnId,
			resId: resId,
			params: params,
		});

		// Create and await a promise to get function response
		let response = await new Promise ((resolve, reject) => {
			// Listen for a response on generated response ID
			this._stream.once ('fnRes.' + resId, (response) => {
				// Resolve promise with recieved data
				resolve (response);
			});
		});

		return response;
	}

	// Induced by implementations of `Rpc`
	_disconnect () {
		this.emit ('disconnect');
	}
}

class ServerIpcInterface extends EventEmitter {
	constructor (socket, cryptKey, onDisconnect) {
		super ();

		// Set private class variables
		this._socket       = socket;
		this._onDisconnect = onDisconnect;
		this._cryptKey     = cryptKey;

		this._listen ();
	}

	_listen () {
		ipc.server.on ('message', (data, socket) => {
			if (socket.id != this._socket.id) {
				return // Not for our socket, ignore
			}

			// silently ignore bad data
			if (data.nonce == null || data.encrypted == null) return;

			// open nacl secret box
			let decrypted = nacl.secretbox.open (Buffer.from (data.encrypted, 'base64'), Buffer.from (data.nonce, 'base64'), this._cryptKey);

			// silently ignore bad crypt, TODO: handle
			if (decrypted == false) return;

			// decode JSON message
			let decoded = JSON.parse (Buffer.from (decrypted).toString ());

			// emit event
			this.emit (decoded.id, decoded.data);
		});

		ipc.server.on ('socket.disconnected', (socket) => {
			if (socket.id != this._socket.id) {
				return // Not for our socket, ignore
			}

			this._onDisconnect ();
		});
	}

	send (id, data) {
		// Encode object to JSON
		let encoded = JSON.stringify ({
		  'id'   : id,
		  'data' : data
		});

		// Generate a random nonce for cryptography
		let nonce = nacl.randomBytes (nacl.box.nonceLength);

		// Encrypt encoded object using nonce, hardcoded server public key and our secret key
		let encrypted = nacl.secretbox (Buffer.from (encoded), nonce, this._cryptKey);

		// Send nonce, from secret key, and encrypted data over IPC
		ipc.server.emit (this._socket, 'message', {
		  'nonce'     : Buffer.from (nonce).toString ('base64'),
		  'encrypted' : Buffer.from (encrypted).toString ('base64')
		});
	}
}

class ServerIpcRpc extends Rpc {
	constructor (socket, cryptKey, child) {
		// Create event interface from provided ipc socket
		let ipcInterface = new ServerIpcInterface (socket, cryptKey, () => {
			// Induce self disconnect when socket interface disconnected
			this._disconnect ();
		});

		// Create parent RPC instance using interface as stream
		super (ipcInterface, child);
	}
}

class ServerIpcRpcMaster extends EventEmitter {
	constructor(namespace, cryptKey, child) {
		super ();

		// Build IPC
		ipc.config.id     = namespace;
		ipc.config.retry  = 1500;
		ipc.config.silent = true;

		// Start IPC server
		ipc.serve ();
		ipc.server.start ();

		ipc.server.on ('connect', (socket) => {
			let clientRpc = new ServerIpcRpc (socket, cryptKey, child);
			this.emit ('client', clientRpc);
		});
	}
}

class ClientIpcInterface extends EventEmitter {
	constructor (namespace, cryptKey) {
		// Create parent event emitter
		super ();

		this._namespace = namespace;
		this._cryptKey  = cryptKey;

		// build ipc
		ipc.config.id     = namespace;
		ipc.config.retry  = 1500;
		ipc.config.silent = true;

		ipc.connectTo (namespace, () => {
			this._listen ();
		});
	}

	_listen () {
		ipc.of[this._namespace].on ('message', (data) => {
			// silently ignore bad data
			if (data.nonce == null || data.encrypted == null) return;

			// open nacl secret box
			let decrypted = nacl.secretbox.open (Buffer.from (data.encrypted, 'base64'), Buffer.from (data.nonce, 'base64'), this._cryptKey);

			// silently ignore bad crypt, TODO: handle
			if (decrypted == null) return;

			// decode JSON message
			let decoded = JSON.parse (Buffer.from (decrypted).toString ());

			// emit event
			this.emit (decoded.id, decoded.data);
		});
	}

	send (id, data) {
		// Encode object to JSON
		let encoded = JSON.stringify ({
		  'id'   : id,
		  'data' : data,
		});

		// Generate a random nonce for cryptography
		let nonce = nacl.randomBytes (nacl.box.nonceLength)

		// Encrypt encoded object using nonce, hardcoded server public key and our secret key
		let encrypted = nacl.secretbox (Buffer.from (encoded), nonce, this._cryptKey)

		// Send nonce, from secret key, and encrypted data over IPC
		ipc.of[this._namespace].emit ('message', {
		  'nonce'     : Buffer.from (nonce).toString ('base64'),
		  'encrypted' : Buffer.from (encrypted).toString ('base64')
		});
	}
}

class ClientIpcRpc extends Rpc {
	constructor (namespace, cryptKey, client) {
		// Create client IPC interface for provided namespace
		let ipcInterface = new ClientIpcInterface (namespace, cryptKey);

		// Create parent RPC module using interface as stream
		super (ipcInterface, client);
	}
}

exports = module.exports = { ClientIpcRpc, ServerIpcRpcMaster };