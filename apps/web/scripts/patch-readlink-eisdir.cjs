const fs = require('fs')

function normalizeReadlinkError(error) {
  if (error && error.code === 'EISDIR' && error.syscall === 'readlink') {
    error.code = 'EINVAL'
  }
  return error
}

const readlink = fs.readlink
fs.readlink = function patchedReadlink(...args) {
  const callback = args[args.length - 1]
  if (typeof callback === 'function') {
    args[args.length - 1] = function patchedCallback(error, ...rest) {
      callback.call(this, normalizeReadlinkError(error), ...rest)
    }
  }
  return readlink.apply(this, args)
}

const readlinkSync = fs.readlinkSync
fs.readlinkSync = function patchedReadlinkSync(...args) {
  try {
    return readlinkSync.apply(this, args)
  } catch (error) {
    throw normalizeReadlinkError(error)
  }
}

if (fs.promises && fs.promises.readlink) {
  const readlinkPromise = fs.promises.readlink.bind(fs.promises)
  fs.promises.readlink = async function patchedReadlinkPromise(...args) {
    try {
      return await readlinkPromise(...args)
    } catch (error) {
      throw normalizeReadlinkError(error)
    }
  }
}
