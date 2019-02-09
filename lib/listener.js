const fs = require('fs')
const net = require('net')
const tls = require('tls')
const http = require('http')
const https = require('https')
const http2 = require('http2')
const EventEmitter = require('events')

const httpServerSymbol = Symbol('httpServer')
const httpsServerSymbol = Symbol('httpsServer')
const http2ServerSymbol = Symbol('http2Server')

const httpEnableSymbol = Symbol('httpEnable')
const httpsEnableSymbol = Symbol('httpsEnable')
const http2EnableSymbol = Symbol('http2Enable')

const contexts = Symbol('contexts')
const socketPools = Symbol('socketPools')
const listenPools = Symbol('listenPools')
const serverPools = Symbol('serverPools')

const connectionListenerSymbol = Symbol('connectionListener')

class Listener extends EventEmitter {
  constructor(options, onRequest){
    super()
    this[contexts] = new Map()
    this[listenPools] = new Map()
    this[socketPools] = new Map()
    this[serverPools] = new Map()

    if (typeof options === 'function' && onRequest === void 0) {
      onRequest = options
      options = {}
    }
    this.SNICallback = SNICallback.bind(this)
    this[connectionListenerSymbol] = connectionListener.bind(this)
    initialize.call(this, options)

    if (typeof onRequest === 'function') {
      this.setOnRequest(onRequest)
    }
    if (options && options.listen) {
      this.listen(options.listen)
    }
  }
  /**
   * 会强制回收 所有链接会话
   */
  destroy(){
    // 关闭监听
    return this.close(true)
  }
  /**
   * 关闭监听，不会影响已经建立链接的会话
   */
  async close(isGraceful = false){
    this[httpServerSymbol] = null
    this[httpsServerSymbol] = null
    this[http2ServerSymbol] = null

    this[httpEnableSymbol] = false
    this[httpsEnableSymbol] = false
    this[http2EnableSymbol] = false

    this.SNICallback = null
    if (this[contexts] && this[contexts] instanceof Map) {
      this[contexts].clear()
    }
    // 解除监听
    await this.unListen()
    // 如果存在 长连接池
    if (isGraceful===true && this[socketPools] && this[socketPools] instanceof Map) {
      // 遍历销毁
      this[socketPools].forEach(socket=>(socket.destroy && socket.destroy()))
      // 清除长连接池
      this[socketPools].clear()
    }
  }
  /**
   * 解除监听
   *
   * @param      {<type>}   options  The options
   * @return     {Promise}  { description_of_the_return_value }
   */
  unListen(options) {
    const ids = []
    if(typeof options === typeof void 0){
      if (this[serverPools] instanceof Map) {
        Array.prototype.push.apply(ids, Array.from(this[serverPools].keys()))
      }
    }else if(typeof options === 'string'){
      // id
      ids.push(options)
    }else if(typeof options === 'object'){
      if (Array.isArray(options)) {
        // 并列执行监听承诺
        return Promise.all(options.map(option => this.listen(option)))
      }else{
        // {类型, 监听}
        const {listen} = listenOptionsFormat.call(this, options)
        // id
        ids.push(JSON.stringify(listen))
      }
    }
    return Promise.all(ids.map(id => {
      const server = this[contexts].get(id)
      if (server && server.close) {
        server.close()
        this[contexts].delete(id)
      }
    }))
  }
  /**
   * 监听
   *
   * @param      {Function}  options  The options
   * @return     {Promise}   { description_of_the_return_value }
   */
  async listen(options) {
    if (Array.isArray(options)) {
      // 并列执行监听承诺
      return Promise.all(options.map(option => this.listen(option)))
    }
    // {类型, 监听}
    const {type, listen} = listenOptionsFormat.call(this, options)
    // id
    const id = JSON.stringify(listen)
    // 试图获取监听对象  
    if (this[listenPools].get(id)) {
      await this.unListen(id)
    }
    // 创建 tcp 网络服务
    const server = net.createServer()
    // 协议类型
    server.$easyke$type = type
    // 监听
    server.$easyke$listen = listen
    // 监听 网络端口
    await new Promise((resolve, reject)=>{
      let onError = e => {
        if (reject) {
          server.off('error', onError)
          server.off('listening', onListening)
          reject(e)
          resolve = reject = void 0
        }
      }
      let onListening = () => {
        if (resolve) {
          server.off('error', onError)
          server.off('listening', onListening)
          resolve()
          resolve = reject = void 0
        }
      }
      // 一次性监听错误
      server.once('error', onError)
      // 一次性绑定监听
      server.once('listening', onListening)
      // 开始监听
      server.listen(server.$easyke$listen)
    })
    // 加入监听池
    this[listenPools].set(id, server)
    // 绑定 监听链接建立事件
    server.on('connection', this.connectionListener)
    // 解除事件
    server.once('close', function(){
      this.off('connection')
    })
  }
  addContext(hostname, context) {
    if (context instanceof tls.SecureContext) {
      this[contexts].set(hostname, context)
    }else{
      this.addContext(hostname, tls.createSecureContext(context))
    }
  }
  setOnRequest(fn){
    if (typeof fn === 'function') {
      this.httpServerEnable && this.httpServer.on('request', fn)
      this.httpsServerEnable && this.httpsServer.on('request', fn)
      this.http2ServerEnable && this.http2Server.on('request', fn)
    }
  }
  get httpServer(){
    return this[httpServerSymbol] || null
  }
  get httpsServer(){
    return this[httpsServerSymbol] || null
  }
  get http2Server(){
    return this[http2ServerSymbol] || null
  }
  get httpServerEnable(){
    return this[httpEnableSymbol] || false
  }
  get httpsServerEnable(){
    return this[httpsEnableSymbol] || false
  }
  get http2ServerEnable(){
    return this[http2EnableSymbol] || false
  }
  // 返回一个监听者
  get connectionListener(){
    return this[connectionListenerSymbol] || ( socket => socket.destroy() )
  }
}
/**
 * { function_description }
 *
 * @class      SNICallback (name)
 * @param      {<type>}    servername  The servername
 * @param      {Function}  cb          { parameter_description }
 */
function SNICallback(servername, cb){
  console.log(servername)
  if (this[contexts] && this[contexts] instanceof Map) {
    const context = this[contexts].get(servername)
    if (context) {
      if (context instanceof tls.SecureContext) {
        cb(null, context)
      }else{
        cb(null, tls.createSecureContext(context))
      }
    }else{
      cb(new Error('No certificate'), null)
    }
  }else{
    cb(new Error('No certificate'), null)
  }
}
/**
 * { function_description }
 *
 * @param      {<type>}  socket  The socket
 */
function connectionListener(socket){
  // 存储 链接管道
  this[socketPools].set((socket.remoteAddress + ':' + socket.remotePort), socket)
  // 存储解除方法
  socket.$easyke$unsocket = unsocket.bind({socket, listener: this})
  // 用于后续解除绑定
  socket.once('end', socket.$easyke$unsocket)
  // 用于后续解除绑定
  socket.once('close', socket.$easyke$unsocket)
  // 取得协议类型
  const type = socket.server && socket.server.$easyke$type

  // 如果是 ssl、tls 类型
  if (type === 'ssl' || type === 'tls') {
    if (this[http2EnableSymbol]) {
      // 使用 http2 服务来处理
      this[http2ServerSymbol].emit('connection', socket)
    }else if (this[http2EnableSymbol]){
      // 使用 https 服务来处理
      this[httpsServerSymbol].emit('connection', socket)
    }else{
      // 否则销毁链接
      socket.destroy()
    }
  }else{
    // 否则使用 http 服务来处理
    if (this[httpServerSymbol] && this[httpServerSymbol].emit) {
      // 出发一个链接
      this[httpServerSymbol].emit('connection', socket)
    }else{
      // 否则销毁链接
      socket.destroy()
    }
  }
}
/**
 * { function_description }
 *
 * @param      {<type>}  options  The options
 */
function initialize (options){
  if (options.http!==false) {
    // 初始化http服务
    this[httpServerSymbol] = http.createServer()
    this[httpEnableSymbol] = true
  }
  if (options.http2!==false) {
    // 初始化http2服务
    let http2Options = Object.create(null)
    if (typeof options.http2 === 'function') {
      http2Options = Object.assign(Object.create(null), options.http2(this))
    }else if (typeof options.http2 === 'object') {
      http2Options = Object.assign(Object.create(null), options.http2)
    }
    http2Options.SNICallback = this.SNICallback
    if (typeof http2Options.allowHTTP1 === typeof void 0) {
      http2Options.allowHTTP1 = true
    }
    this[http2ServerSymbol] = http2.createSecureServer(http2Options)
    this[http2EnableSymbol] = true
  }else if (options.https!==false) {
    // 如果没有初始化http2服务，然而没有拒绝初始化了https服务
    let httpsOptions = Object.create(null)
    if (typeof options.https === 'function') {
      httpsOptions = Object.assign(Object.create(null), options.https(this))
    }else if (typeof options.https === 'object') {
      httpsOptions = Object.assign(Object.create(null), options.https)
    }
    httpsOptions.SNICallback = this.SNICallback
    this[httpsServerSymbol] = https.createSecureServer(httpsOptions)
    this[httpsEnableSymbol] = true
  }
}
/**
 * { function_description }
 */
function unsocket(){
  const {socket = void 0, listener = void 0} = (this || {})
  if (listener && socket && socket.$easyke$unsocket) {
    socket.off('end', socket.$easyke$unsocket)
    socket.off('close', socket.$easyke$unsocket)
    if (listener[socketPools] instanceof Map) {
      listener[socketPools].delete(socket.remoteAddress + ':' + socket.remotePort)
    }
    delete socket.$easyke$unsocket
  }
}
/**
 * { function_description }
 *
 * @param      {Function}  options  The options
 */
function listenOptionsFormat(options){
  const optionsType = typeof options
  const res = {
    type: 'tcp'
  }
  if (optionsType === 'string' || optionsType === 'number') {
    res.listen = isNumber(options) ? {
      port: options
    } : {
      path: options
    }
  }else{
    if (optionsType === 'function') {
      options = options(this)
    }
    switch(typeof options){
      case 'string':
      case 'number':
      res.listen = isNumber(options) ? {
        port: options
      } : {
        path: options
      }
      case 'object':
      res.type = options.type || 'tcp'
      if (options.path) {
        res.listen = {
          path: options.path
        }
      }else{
        if (options.port) {
          res.listen = {
            port: options.port
          }
        }
        if (options.host || options.hostname) {
          res.listen = {
            host: options.host || options.hostname
          }
        }
      }
      break;
    }
  }
  if (res.listen === void 0) {
    res.listen = {
      port:0
    }
  }
  return res
}
/**
 * Determines if number.
 *
 * @param      {<type>}   obj     The object
 * @return     {boolean}  True if number, False otherwise.
 */
function isNumber(obj) {
  return obj === +obj
}
module.exports = Listener