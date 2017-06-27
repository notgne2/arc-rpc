'use strict'; // always strict mode

// Import dependencies
const EventEmitter                               = require ('events').EventEmitter;
const uuid                                       = require ('uuid');
const { TrannyServer, TrannyClient, genKeyPair: genSocketKeyPair } = require ('cryptotranny');

// Create RPC events class
class RpcEvents extends EventEmitter {
  constructor (stream) {
    super ();

    // Store stream variable as property and listen for events
    this._stream = stream;
    this._listen ();
  }

  send (id, ...params) {
    // Emit event to remote
    this._stream.send ('evt', {
      params : params,
      id     : id,
    });
  }

  _listen () {
    // Listen for remote user events
    this._stream.on ('evt', (data) => {
      // Rebroadcast to listeners on self
      this.emit (data.id, ...data.params);
    });
  }
}

// Create general RPC class
class Rpc extends EventEmitter {
  constructor (stream, child) {
    // Induce spawning of parent/super event emitter
    super ();

    // Set own ID for identification
    this.id = uuid ();

    // Set mock for accessing methods
    this.class = this._genClass ();

    // Set child for handling plain events
    this.events = new RpcEvents (stream);

    // Give child class instance a copy of this/RPC
    if (child != null && child._handleRpc != null) child._handleRpc (this);

    // Set private variables
    this._stream = stream;
    this._child = child;

    // Listen for events if have child class
    if (child != null) this._listen ();
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

      // Find internal handler
      let handler = this._child[call.fnId].bind(this._child);

      // Handle inexistence
      if (handler == null) {
        this._stream.send ('fnRes.' + call.resId, {
          isError : true,
          data    : 'No such method',
        });

        return;
      }

      let params = call.params.map ((param) => {
        if (param.isFunc) {
          return (...fnParams) => {
            this._stream.send ('cbRes.' + param.funcId, {
              params: fnParams,
            });
          }
        } else {
          return param.data;
        }
      })

      // Try getting response from handler or handle error
      try {
        // Run with applied params and await result
        response = await handler (...params);
      } catch (err) {
        // Emit error as response
        this._stream.send ('fnRes.' + call.resId, {
          isError: true,
          data: err,
        });

        return;
      }

      // Emit success and function return result
      this._stream.send ('fnRes.' + call.resId, {
        isError: false,
        data: response,
      });
    });
  }

  async _call (fnId, params) {
    // Generate ID to listen for responses on
    let resId = uuid ();

    let parsedParams = params.map ((param) => {
      if (typeof param == "function") {
        let funcId = uuid ();

        this._stream.on ('cbRes.' + funcId, (res) => {
          param (...res.params);
        });

        return {
          isFunc: true,
          funcId: funcId,
        }
      } else {
        return {
          isFunc: false,
          data: param,
        }
      }
    });

    // Emit the remote call event
    this._stream.send ('fnCall', {
      fnId: fnId,
      resId: resId,
      params: parsedParams,
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
    // Emit disconnect event so users of RPC will be aware
    this.emit ('disconnect');
  }
}

class ServerSocketInterface extends EventEmitter {
  constructor (client) {
    super ();

    // Set private class variables
    this._client       = client;

    // Listen for IPC data
    this._listen ();
  }

  _listen () {
    this._client.on ('message', (data) => {
      // decode JSON message
      let decoded = JSON.parse (data.toString ());

      // emit event
      this.emit (decoded.id, decoded.data);
    });
  }

  send (id, data) {
    // Encode object to JSON
    let encoded = Buffer.from (JSON.stringify ({
      'id'   : id,
      'data' : data
    }));

    // Send nonce, from secret key, and data over IPC
    this._client.send (encoded);
  }
}

class ServerSocketRpc extends Rpc {
  constructor (socket, child) {
    // Create event interface from provided ipc socket
    let ipcInterface = new ServerSocketInterface (socket);

    // Create parent RPC instance using interface as stream
    super (ipcInterface, child);
  }
}

class ServerSocketRpcMaster extends EventEmitter {
  constructor(port, keyPair, child) {
    super ();

    let server = new TrannyServer(keyPair, port);

    server.on ('client', (client) => {
      let clientRpc = new ServerSocketRpc (client, child);
      this.emit ('client', clientRpc);
    });
  }
}

class ClientSocketInterface extends EventEmitter {
  constructor (host, port, keyPair, remotePk) {
    // Create parent event emitter
    super ();

    let server = new TrannyClient(host, port, keyPair, remotePk)

    this._server = server;

    this._listen ();
  }


  _listen () {
    this._server.on ('message', (data) => {
      let decoded = JSON.parse (data.toString ());

      this.emit (decoded.id, decoded.data);
    })
  }

  send (id, data) {
    // Encode object to JSON
    let encoded = Buffer.from (JSON.stringify ({
      'id'   : id,
      'data' : data,
    }));

    this._server.send (encoded);
  }
}

class ClientSocketRpc extends Rpc {
  constructor (host, port, keyPair, remotePk, client) {
    // Create client IPC interface for provided namespace
    let socketInterface = new ClientSocketInterface (host, port, keyPair, remotePk);

    // Create parent RPC module using interface as stream
    super (socketInterface, client);
  }
}

// Export classes
exports = module.exports = { Rpc, ClientSocketRpc, ServerSocketRpcMaster, genSocketKeyPair };