module.exports = {
  deferRun,
  getProtocolHost
}

function deferRun(fn) {
  if (typeof setImmediate === 'function') {
    setImmediate(fn)
  }else{
    process.nextTick(fn)
  }
}
/**
 * 通过URL来获取 protocol 和 host 部分
 *
 * @param {string} url
 * @private
 */

function getProtocolHost(url) {
  if (!url || url.length === 0 || url[0] === '/') {
    return undefined;
  }

  var searchIndex = url.indexOf('?');
  // 获取path的长度，如果 不存在 search，path长度就是url的长度
  const pathLength = searchIndex !== -1 ? searchIndex : url.length;
  var fqdnIndex = url.substr(0, pathLength).indexOf('://');

  return fqdnIndex !== -1 ? url.substr(0, url.indexOf('/', 3 + fqdnIndex)) : undefined;
}