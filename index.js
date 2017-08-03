'use strict'; // always strict mode

// Import dependencies
const EventEmitter = require ('events').EventEmitter;
const uuid         = require ('uuid');
const ObjectPath   = require ('object-path');
const Dump         = require ('dumpjs');
const Errio        = require ('errio');
const { TrannyServer, TrannyClient, genKeyPair: genSocketKeyPair } = require ('cryptotranny');

const objectPath = ObjectPath.create ({ includeInheritedProps: true });

// Create RPC events class
class RpcEvents extends EventEmitter {
  constructor (stream) {
    super ();

    // Store stream variable as property and listen for events
    this._stream = stream;
    this._listen ();
  }

  // Send new event to remote
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

    this._lastData = {};

    // Set own ID for identification
    this.id = uuid ();

    // Set mock for accessing methods
    this.class = this._genClass ({}, []);

    // Set child for handling plain events
    this.events = new RpcEvents (stream);

    // Set private variables
    this._stream = stream;
    this._child = child;

    // Give child class instance a copy of this/RPC
    if (child != null && child._handleRpc != null) child._handleRpc (this);

    this._listen ();
  }

  _genClass (base, path) {
    // Create handler for proxy class
    let proxyHandler = {
      // Handle get on proxy class
      get: (target, property) => {
        let propPath = path.slice (0);
        propPath.push (property);

        if (base[property] != null) {
          if (base[property] instanceof Object) {
            return this._genClass (base[property], propPath);
          } else {
            return base[property];
          }
        }

        let handler = (async (...params) => {
          let out = await this._call (propPath, params, path);

          if (out.isError) {
            throw Errio.fromObject (out.data);
          } else {
            return out.data;
          }
        });

        return this._genClass (handler, propPath)
      },
    };

    // Create a new `Proxy` to act as our class
    let proxy = new Proxy (base, proxyHandler);

    // Return the proxy
    return proxy;
  }

  _listen () {
    this._stream.on ('dataUpdate', async (data) => {
      this._lastData = data;
      this.class = this._genClass (data, []);
    });

    this._stream.on ('propUpdate', async (data) => {
      objectPath.set (this._lastData, data.path, data.value);
      this.class = this._genClass (this._lastData, []);
    });
  }

  allow (updates) {
    // Don't bother if no child
    if (this._child == null) return;

    if (updates) {
      this._stream.send ('dataUpdate', this._child);

      let traverse = (part, path) => {
        Object.keys (part).forEach((key) => {
          if (part[key] !== null && part[key] instanceof Object) {
            let partPath = path.slice (0);
            partPath.push (key);

            part[key] = new Proxy (part[key], {
              set: (target, prop, value, reciever) => {
                let propPath = partPath.slice (0);
                propPath.push (prop);

                this._stream.send ('propUpdate', {
                  path: propPath,
                  value: value,
                });

                target[prop] = value;
                return true;
              },
            });

            traverse(part[key], partPath);
          }
        });
      };

      traverse (this._child, []);
    }

    // Listen for function calls
    this._stream.on ('fnCall', async (call) => {
      // Create response variable on higher scope
      let response = null;

      // Find internal handler and parent
      let handler = objectPath.get (this._child, call.path);
      let parent  = objectPath.get (this._child, call.parentPath);

      // Handle inexistence
      if (handler == null) {
        this._stream.send (call.resId, {
          isError : true,
          data    : 'No such method',
        });

        return;
      }

      let params = call.params.map ((param) => {
        if (param.isFunc) {
          return (...fnParams) => {
            this._stream.send (param.funcId, {
              params: fnParams,
            });
          }
        } else {
          return param.data;
        };
      })

      // Try getting response from handler or handle error
      try {
        // Run with applied params and await result
        response = await handler.bind (parent) (...params);
      } catch (err) {
        // Emit error as response
        this._stream.send (call.resId, {
          isError: true,
          data: Errio.toObject (err),
        });

        return;
      }

      // Emit success and function return result
      this._stream.send (call.resId, {
        isError: false,
        data: response,
      });
    });
  }

  async _call (path, params, parentPath) {
    // Generate ID to listen for responses on
    let resId = uuid ();

    let parsedParams = params.map ((param) => {
      if (typeof param == "function") {
        let cbResId = uuid ();

        this._stream.on (cbResId, (res) => {
          param (...res.params);
        });

        return {
          isFunc : true,
          resId  : cbResId,
        }
      } else {
        return {
          isFunc : false,
          data   : param,
        }
      }
    });

    // Emit the remote call event
    this._stream.send ('fnCall', {
      path       : path,
      parentPath : parentPath,
      resId      : resId,
      params     : parsedParams,
    });

    // Create and await a promise to get function response
    let response = await new Promise ((resolve, reject) => {
      // Listen for a response on generated response ID
      this._stream.once (resId, (response) => {
        // Resolve promise with recieved data
        resolve (response);
      });
    });

    return response;
  }

  // Destroy underlying stream
  destroy () {
    this._stream.destroy ();
  }

  // Induced by implementations of `Rpc`
  _onDisconnect () {
    // Emit disconnect event so users of RPC will be aware
    this.emit ('disconnected');
  }
}

class ServerSocketInterface extends EventEmitter {
  constructor (client, onDisconnect) {
    super ();

    // Set private class variables
    this._client       = client;
    this._onDisconnect = onDisconnect;

    // Listen for IPC data
    this._listen ();
  }

  _listen () {
    this._client.on ('message', (data) => {
      // decode JSON message
      let decoded = Dump.restore (data.toString ());

      // emit event
      this.emit (decoded.id, decoded.data);
    });

    this._client.on ('disconnected', () => {
      this._onDisconnect ();
    });
  }

  send (id, data) {
    // Encode object to JSON
    let encoded = Buffer.from (Dump.dump ({
      'id'   : id,
      'data' : data
    }));

    // Send nonce, from secret key, and data over IPC
    this._client.send (encoded);
  }

  // Destroy underlying connection
  destroy () {
    this._client.destroy ();
  }
}

class ServerSocketRpc extends Rpc {
  constructor (client, child) {
    // Create event interface from provided client
    let ipcInterface = new ServerSocketInterface (client, () => {
      this._onDisconnect ();
    });

    // Create parent RPC instance using interface as stream
    super (ipcInterface, child);

    this.pk = client.pk;
  }
}

class ServerSocketRpcMaster extends EventEmitter {
  constructor(port, keyPair, child) {
    super ();

    // Create new server using cryptotranny
    let server = new TrannyServer(keyPair, port);

    // Listen for new clients
    server.on ('client', (client) => {
      // Wrap client in RPC
      let clientRpc = new ServerSocketRpc (client, child);
      // Emit new client
      this.emit ('client', clientRpc);
    });
  }
}

class ClientSocketInterface extends EventEmitter {
  constructor (host, port, keyPair, remotePk, onDisconnect) {
    // Create parent event emitter
    super ();

    // Create new connection to specified host using cryptotranny
    let server = new TrannyClient(host, port, keyPair, remotePk)

    // Set private properties
    this._server       = server;
    this._onDisconnect = onDisconnect;

    // Listen
    this._listen ();
  }

  // Listen for all events
  _listen () {
    this._server.on ('message', (data) => {
      let decoded = Dump.restore (data.toString ());

      this.emit (decoded.id, decoded.data);
    });

    this._server.on ('disconnected', () => {
      this._onDisconnect ();
    });
  }

  // Send event to remote
  send (id, data) {
    // Encode object to JSON
    let encoded = Buffer.from (Dump.dump ({
      'id'   : id,
      'data' : data,
    }));

    this._server.send (encoded);
  }

  // Destroy underlying connection
  destroy () {
    this._server.destroy ();
  }
}

class ClientSocketRpc extends Rpc {
  constructor (host, port, keyPair, remotePk, client) {
    // Create client IPC interface for provided namespace
    let socketInterface = new ClientSocketInterface (host, port, keyPair, remotePk, () => {
      this._onDisconnect ();
    });

    // Create parent RPC module using interface as stream
    super (socketInterface, client);
  }
}

// Export classes
exports = module.exports = { Rpc, ClientSocketRpc, ServerSocketRpcMaster, genSocketKeyPair };
