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


Supported Caching Drivers
=========================

| Driver     | Requires         | Maximum object size | List Support | Vacuume Support |
|------------|------------------|---------------------|--------------|-----------------|
| filesystem | Writable FS area | Infinite            | Yes          | No              |
| memcached  | MemcacheD daemon | 1mb                 | No           | No              |
| memory     | Nothing          | Infinite            | Yes          | Yes             |
| mongodb    | MongoDB daemon   | 16mb                | Yes          | Yes             |
| redis      | Redis daemon     | 512mb               | Yes          | No              |


**NOTES**:

* By default MemcacheD cahces 1mb slabs, see the documentation of the daemon to increase this
* While memory storage is theoretically infinite Node has a memory limit of 1.4gb by default. See the node CLI for details on how to increase this
* Some caching systems (notably MemcacheD) automatically vacuume entries


API
===

Cache([options]) (constructor)
------------------------------
Create a new cache handler and populate its default options.


cache.options(Object) or cache.options(key, val)
------------------------------------------------
Set lots of options in the cache handler all at once or set a single key (dotted or array notation are supported).


Valid options are:

| Option                    | Type     | Default                            | Description                                                          |
|---------------------------|----------|------------------------------------|----------------------------------------------------------------------|
| `init`                    | Boolean  | `true`                             | Whether to automatically run cache.init() when constructing          |
| `keyMangle`               | Function | `key => key`                       | How to rewrite the requested key before get / set / unset operations |
| `modules`                 | Array    | `['memory']`                       | What modules to attempt to load                                      |
| `filesystem`              | Object   | See below                          | Filesystem module specific settings                                  |
| `filesystem.fallbackDate` | Date     | `2500-01-01`                       | Fallback date to use as the filesystem expiry time                   |
| `filesystem.useMemory`    | Boolean  | `false`                            | Whether to also hold copies of the file contents in RAM as well as saving to disk (makes reads quicker but uses more memory) |
| `filesystem.memoryFuzz`   | Number   | `200`                              | How many Milliseconds bias to use when comparing the file ctime to the memory creation date |
| `filesystem.path`         | Function | os.tempdir + key + '.cache.json'   | How to calculate the file path to save. Defaults to the OS temp dir  |
| `filesystem.pathSwap`     | Function | " + " + '.cache.swap.json'         | How to calculate the swap path to save. Defaults to the OS temp dir  |
| `memcached`               | Object   | See below                          | MemcacheD module specific settings                                   |
| `memcached.server`        | String   | `'127.0.0.1:11211'`                | The MemcacheD server address to use                                  |
| `memcached.lifetime`      | Number   | `1000*60` (1h)                     | The default expiry time, unless otherwise specified                  |
| `memcached.options`       | Object   | `{retries:1,timeout:250}`          | Additional options passed to the MemcacheD client                    |
| `mongodb`                 | Object   | See below                          | MongoDB module specific options                                      |
| `mongodb.uri`             | String   | `'mongodb://localhost/mfdc-cache'` | The MongoDB URI to connect to                                        |
| `mongodb.collection`      | String   | `mfdcCaches`                       | The collection to store cache information within                     |



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


cache.list(callback)
--------------------
Attempt to return a list of known cache contents.
Callback is called as `(err, items)`.

Each item will have at minimum a `id` and `created` value. All other values (e.g. `expiry`) depend on the cache driver being used.



cache.vacuume([callback])
-------------------------
Attempt to clean up any left over or expired cache entries.
This is only supported by some modules.


cache.destroy([callback])
---------------
Politely close all driver resource handles before shutting down.
This function waits for all set operations to complete - even if you didn't attach a callback.


Debugging
=========
This module uses the [debug NPM module](https://github.com/visionmedia/debug) for debugging. To enable set the environment variable to `DEBUG=cache`.

For example:

```
DEBUG=cache node myFile.js
```
