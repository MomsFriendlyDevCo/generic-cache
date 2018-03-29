@momsfriendlydevco/cache
========================
Generic caching component.

This module is a very low-level caching component designed to store, retrieve, expire and cleanup a simple key-value storage.


```javascript
var Cache = require('@momsfriendlydevco/cache');

var storage = new Cache({
	modules: ['memcached', 'mongo', 'memory'], // What modules to try to load (in order of preference)
});


// Set something (key, val, [expiry], [callback])
storage.set('myKey', 'myValue', moment().add(1, 'day'), (err, val) => ...)

// Get something (key, [fallback], callback)
storage.get('myKey', 'fallbackValue', (err, val) => ...)

// Forget something (key, [callback])
storage.unset('myKey', err => ...)

// Clean up storage, only supported by some modules ([callback])
storage.vacuume(err => ...)

// Hash something, objects also supported
storage.hash(complexObject, val => ...)
```


API
===

Cache([options]) (constructor)
------------------------------
Create a new cache handler and populate its default options.


cache.options(Object) or cache.options(key, val)
------------------------------------------------
Set lots of options in the cache handler all at once or set a single key (dotted or array notation are supported).


Valid options are:

| Option               | Type     | Default                            | Description                                                          |
|----------------------|----------|------------------------------------|----------------------------------------------------------------------|
| `init`               | Boolean  | `true`                             | Whether to automatically run cache.init() when constructing          |
| `keyMangle`          | Function | `key => key`                       | How to rewrite the requested key before get / set / unset operations |
| `modules`            | Array    | `['memory']`                       | What modules to attempt to load                                      |
| `memcached`          | Object   | See below                          | MemcacheD module specific settings                                   |
| `memcached.server`   | String   | `'127.0.0.1:11211'`                | The MemcacheD server address to use                                  |
| `memcached.lifetime` | Number   | `1000*60` (1h)                     | The default expiry time, unless otherwise specified                  |
| `memcached.options`  | Object   | `{retries:1,timeout:250}`          | Additional options passed to the MemcacheD client                    |
| `mongodb`            | Object   | See below                          | MongoDB module specific options                                      |
| `mongodb.uri`        | String   | `'mongodb://localhost/mfdc-cache'` | The MongoDB URI to connect to                                        |
| `mongodb.collection` | String   | `mfdcCaches`                       | The collection to store cache information within                     |



cache.option()
--------------
Alias of `cache.options()`.


cache.init([callback])
----------------------
Initialize the cache handler and attempt to load the modules in preference order.
This function is automatically executed in the constructor if `cache.settings.init` is truthy.


cache.set(Object, [expiry], [callback]) or cache.set(key, value, [expiry], [callback])
--------------------------------------------------------------------------------------
Set a collection of keys or a single key with the optional expiry.


cache.get(key, [fallback], callback)
------------------------------------
Fetch a single value and call the callback. If the value does not exist the fallback value will be provided.
Callback is called as `(err, value)`.


cache.vacuume([callback])
-------------------------
Attempt to clean up any left over or expired cache entries.
This is only supported by some modules.


Debugging
=========
This module uses the [debug NPM module](https://github.com/visionmedia/debug) for debugging. To enable set the environment variable to `DEBUG=cache`.

For example:

```
DEBUG=cache node myFile.js
```
