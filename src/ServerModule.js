const EventEmitter   = require('events');
const dgram          = require('dgram');

const MAX_MESSAGE_ID = 65535; // uint16
let MESSAGE_ID       = 0;

class Client extends EventEmitter {
  constructor(server, host, port, id, name, type, version) {
    super();

    this._host    = host;
    this._port    = port;
    this._id      = id;
    this._name    = name;
    this._type    = type;
    this._version = version;

    this.setTime();

    this.server = server;
  }

  send(topic, data) {
    return this.server.send(this, topic, data);
  }

  setTime() {
    this._time = Date.now();
  }

  get time() {
    return this._time;
  }

  get host() {
    return this._host;
  }

  get port() {
    return this._port;
  }

  get id() {
    return this._id;
  }

  get name() {
    return this._name;
  }

  get type() {
    return this._type;
  }

  get version() {
    return this._version;
  }
}

class Server extends EventEmitter {
  constructor(port) {
    super();

    this._port    = port;
    this._clients = {};

    this._pingDelay       = 7000;
    this._pingTimeOut     = 15000;
    this._messageTimeOut  = 5000;

    this.socket = dgram.createSocket('udp4');

    this.socket.on('error', (err) => {
      console.log(`server error:\n${err.stack}`);
      this.socket.close();
    });

    this.socket.on('message', (buffer, rinfo) => {
      const payload = JSON.parse(buffer.toString());
      const client = this.getClient(payload.moduleId);

      if (!!client) {
        client.setTime(); // Update the time of last packet received

        if (payload.topic == 'ping') {
          // Do nothing
        } else if (payload.topic == 'disconnect') {
          this.rmClient(payload.moduleId);
        } else {
          client.emit(payload.topic, payload.data);
          client.emit('*', payload.topic, payload.data);
          // this.emit(payload.topic, payload.data);
        }
      } else {
        if (payload.topic == 'connect') {
          this.newClient(rinfo.address, rinfo.port, payload.moduleId, payload.data.name, payload.data.type, payload.data.version);
        }
      }
    });

    this.socket.on('listening', () => {
      const address = this.socket.address();
      console.log(`server listening ${address.address}:${address.port}`);
    });

    this.socket.bind(this._port);

    setInterval(() => {
      const now = Date.now();
      let client, name, passed;

      for (name in this._clients) {
        client = this._clients[name];

        passed = now - client.time;

        if (passed > this._pingDelay) {
          if (passed < this._pingTimeOut) {
            client.send('ping');
          } else {
            console.log('timeout', client.id);
            this.rmClient(client.id);
          }
        }
      }
    }, 1000 / 30);
  }

  newClient(host, port, id, name, type, version) {
    const client = new Client(this, host, port, id, name, type, version);

    this._clients[id] = client;

    client.send('connect', { timeout: this._pingTimeOut });
    this.emit('connection', client);
  }

  getClient(id) {
    return this._clients[id];
  }

  rmClient(id) {
    const client = this._clients[id];

    client.send('disconnect');
    client.emit('disconected');

    delete this._clients[id];
  }

  async send(client, topic, data) {
    console.log(topic, data);
    return await new Promise((resolve, reject) => {
      const messageId = this._genMessageID();
      const buffer    = new Buffer(JSON.stringify({ messageId: messageId, topic: topic, data: data }));
      let timeout;

      client.once(messageId, (data) => {
        clearTimeout(timeout);
        resolve(data);
      });

      this.socket.send(buffer, 0, buffer.length, client.port, client.host, (err) => {
        if (err) {
          reject(err);
        } else {
          timeout = setTimeout(() => {
            client.removeAllListeners(messageId);
            reject(err);
          }, this._messageTimeOut);
        }
      });
    });
  }

  /**
  * Generate a message ID
  * @return {int} Message ID
  */
  _genMessageID() {
    MESSAGE_ID = ++MESSAGE_ID;
    MESSAGE_ID = MESSAGE_ID > MAX_MESSAGE_ID ? 0 : MESSAGE_ID;

    return MESSAGE_ID;
  }

  close() {
    this.socket.close();
  }

  get port() {
    return this._port;
  }

  get clients() {
    let c = [];

    for (let i in this._clients) {
      c.push({id: this._clients[i].id, name: this._clients[i].name, type: this._clients[i].type, version: this._clients[i].version});
    }

    return c;
  }
}

module.exports = Server;
