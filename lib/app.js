'use strict'
module.exports = createApp

const app = Symbol('app')
const http = require('http')
const http2 = require('http2')
const WebSocket = require('ws')
const parseUrl = require('parseurl')
const Listener = require('./listener.js')
const finalhandler = require('finalhandler')
const {
  deferRun,
  getProtocolHost
} = require('./util')

function createApp(options) {
  return (new Application(options)).app
}
class Application {
  constructor(options) {
    this.stack = []
  }
  handle(...args) {
    // 获取上下文
    const context = parseArgs(args)
    // 或许协议+主机名
    const protohost = getProtocolHost(context.req.url) || ''
    // 存储原始URL
    context.req.originalUrl = context.req.originalUrl || context.req.url;
    // 开始运行中间件栈
    this.runStack(context, protohost)
  }
  runStack(context, protohost = '', error = null, index = 0, removed = '', slashAdded = false){
    const { req, res } = context
    const isWebSocket = context.ws instanceof WebSocket
    const next = () => nextIndex === ++index && this.runStack(context, protohost, error, index, removed, slashAdded)
    const nextIndex = index + 1
    if (slashAdded) {
      req.url = req.url.substr(1);
      slashAdded = false;
    }
    if (removed.length !== 0) {
      req.url = protohost + removed + req.url.substr(protohost.length)
      removed = ''
    }
    // 路由数据
    const path = parseUrl(req).pathname || '/'

    // 从中间件 栈中取第几栈
    const layer = this.stack[index]

    // 全部中间件都完成了，所以调用完成退出
    if (layer) {
      // 如果请求是 webSocket 但是该中间件，不是一个 webSocket 中间件，所以需要跳过本中间件
      // 如果中间件 是一个 webSocket 中间件，不适合 http请求，所以需要跳过本中间件
      if (isWebSocket !== layer.isWebSocket) {
        // 下一步
        return next()
      }
    }else{
      /**
       * 既然没有找到中间件栈了
       * 延迟执行 最终函数处理程序
       */
      return deferRun(() => {
        if (isWebSocket) {
          this.logerror('长链接连接')
        } else {
          // 最终函数处理程序
          (context.next || finalhandler(req, res, {
            env: process.env.NODE_ENV || 'development',
            onerror: context.onError || this.logerror
          }))()
        }
      })
    }

    const route = layer.path

    // 如果路由的path前缀不匹配，则跳过此中间件
    if (path.toLowerCase().substr(0, route.length) !== route.toLowerCase()) {
      // 错误传递到下一个
      return next()
    }

    // 如果路由匹配没有边界'/'、'.'或 已经结束，则跳过
    var c = path.length > route.length && path[route.length];
    if (c && c !== '/' && c !== '.') {
      return next()
    }

    // trim off the part of the url that matches the route
    if (route.length !== 0 && route !== '/') {
      removed = route;
      req.url = protohost + req.url.substr(protohost.length + removed.length);

      // ensure leading slash
      if (!protohost && req.url[0] !== '/') {
        req.url = '/' + req.url;
        slashAdded = true;
      }
    }
    const arity = layer.handle.length
    const hasError = Boolean(error)

    try {
      if (hasError && arity === 4) {
        // error-handling middleware
        if (context.ws) {
          layer.handle.call(context, error, context.ws, req, next)
        }else{
          layer.handle.call(context, error, req, context.res, next)
        }
        return
      } else if (!hasError && arity < 4) {
        // request-handling middleware
        if (context.ws) {
          layer.handle(context.ws, req, next)
        } else {
          layer.handle(req, context.res, next)
        }
        return
      }
    } catch (e) {
      // replace the error
      error = e;
    }
    // 继续
    return next()
  }
  logerror(err) {
    if (err) {
      console.error(err.stack || err.toString())
    }
  }
  ws(path, handle) {
    return this.use(path, handle, 'get', true)
  }
  get(path, handle) {
    return this.use(path, handle, 'get')
  }
  post(path, handle) {
    return this.use(path, handle, 'post')
  }
  put(path, handle) {
    return this.use(path, handle, 'put')
  }
  delete(path, handle) {
    return this.use(path, handle, 'delete')
  }
  use(path, handle, method = 'all', isWebSocket = false) {
    // 一层中间件
    const layer = { path, handle, method, isWebSocket }
    // 如果地址不是一个字符串
    if (!handle && typeof path !== 'string') {
      layer.handle = path
    }
    if (typeof layer.path !== 'string') {
      // path 默认为 '/'
      layer.path = '/'
    }
    // 包装子应用程序
    if (typeof layer.handle.handle === 'function') {
      const server = layer.handle
      layer.handle = (...args) => server.handle(...args)
    }

    // 取得1.0的监听器
    if (layer.handle instanceof http.Server) {
      layer.handle = layer.handle.listeners('request')[0]
    }

    // 删除最后一个斜杆
    if (layer.path[layer.path.length - 1] === '/') {
      layer.path = layer.path.slice(0, -1)
    }

    // 添加 这一层 中间件 加入 栈
    this.stack.push(layer)

    return this
  }
  listen(options) {
    return new Listener(
      options,
      this.app,
      this.app
    )
  }
  get app() {
    if (!this[app]) {
      this[app] = Object.assign(this.handle.bind(this), {
        listen: this.listen.bind(this),
        use: this.use.bind(this),
        ws: this.ws.bind(this),
        get: this.get.bind(this),
        post: this.post.bind(this),
        put: this.put.bind(this),
        delete: this.delete.bind(this)
      })
    }
    return this[app]
  }
}

function parseArgs(args) {
  const context = Object.create(null)
  if (Array.isArray(args)) {
    for (var i = args.length - 1; i >= 0; i--) {
      // function
      if (typeof args[i] === 'function') {
        if (!context.next) {
          context.next = args[i]
        } else if (!context.onError) {
          context.onError = args[i]
        }else{
          continue
        }
      // http1.x - request
      } else if (args[i] instanceof http.IncomingMessage) {
        context.req = args[i]
        // http1.x - response
      } else if (args[i] instanceof http.ServerResponse) {
        context.res = args[i]
        // http2.x - request
      } else if (args[i] instanceof http2.Http2ServerRequest) {
        context.req = args[i]
        // http2.x - response
      } else if (args[i] instanceof http2.Http2ServerResponse) {
        context.res = args[i]
        // ws - WebSocket
      } else if (args[i] instanceof WebSocket) {
        context.ws = args[i]
      }
    }
  }
  return context
}
Object.assign(createApp, {
  parseArgs,
  Application
})
