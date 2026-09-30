'use strict';
/** Transport factory: config.transport → a transport instance. */
const { TcpServerTransport, TcpClientTransport } = require('./tcp');
const { SerialTransport, listSerialPorts } = require('./serial');
const { FolderTransport } = require('./folder');

/**
 * @param {{type:'serial'|'tcp-server'|'tcp-client'|'folder'}} cfg
 * @param {{SerialPort?:Function}} [deps]
 */
function createTransport(cfg = {}, deps = {}) {
  switch (cfg.type) {
    case 'tcp-server': return new TcpServerTransport(cfg);
    case 'tcp-client': return new TcpClientTransport(cfg);
    case 'serial': return new SerialTransport(cfg, deps);
    case 'folder': return new FolderTransport(cfg);
    default: throw new Error(`Unknown transport type: ${cfg.type}`);
  }
}

module.exports = { createTransport, listSerialPorts };
