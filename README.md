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

All methods may take a callback or return a promise.


Supported Caching Drivers
=========================

| Driver     | Requires         | Maximum object size | Serializer | list() Support | has() support | size() support | vacuume() Support |
|------------|------------------|---------------------|------------|----------------|---------------|----------------|-------------------|
| filesystem | Writable FS area | Infinite            | Yes        | Yes            | Yes           | Yes            |                   |
| memcached  | MemcacheD daemon | 1mb                 | Yes        |                |               |                |                   |
| memory     | Nothing          | Infinite            | Not needed | Yes            | Yes           | Yes            | Yes               |
| mongodb    | MongoDB daemon   | 16mb                | Disabled   | Yes            | Yes           |                | Yes               |
| redis      | Redis daemon     | 512mb               | Yes        | Yes            | Yes           | Yes            |                   |


**NOTES**:

* By default MemcacheD caches 1mb slabs, see the documentation of the daemon to increase this
* While memory storage is theoretically infinite Node has a memory limit of 1.4gb by default. See the node CLI for details on how to increase this
* Some caching systems (notably MemcacheD) automatically vacuume entries
* For most modules the storage values are encoded / decoded via [marshal](https://github.com/MomsFriendlyDevCo/marshal). This means that complex JS primitives such as Dates, Sets etc. can be stored without issue. This is disabled in the case of MongoDB by default but can be enabled if needed
* When `has()` querying is not supported by the module a `get()` operation will be performed and the result mangled into a boolean instead, this ensures that all modules support `has()` at the expense of efficiency


API
===

**NOTE:** In all cases where `[callback]` is specified in the syntax, this module supports either callbacks or promise returns.


Cache([options]) (constructor)
------------------------------
Create a new cache handler and populate its default options.

Note that `cache.init()` needs to be called and needs to complete before this module is usable.


cache.options(Object) or cache.options(key, val)
------------------------------------------------
Set lots of options in the cache handler all at once or set a single key (dotted or array notation are supported).


Valid options are:

| Option                    | Type     | Default                            | Description                                                          |
|---------------------------|----------|------------------------------------|----------------------------------------------------------------------|
| `init`                    | Boolean  | `true`                             | Whether to automatically run cache.init() when constructing          |
| `keyMangle`               | Function | `key => key`                       | How to rewrite the requested key before get / set / unset operations |
| `modules`                 | Array    | `['memory']`                       | What modules to attempt to load                                      |
| `serialize`               | Function | `marshal.serialize`                | The serializing function to use when storing objects                 |
| `deserialize`             | Function | `marshal.deserialize`              | The deserializing function to use when restoring objects             |
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
| `redis`                   | Object   | [See Redis module settings](https://www.npmjs.com/package/redis#rediscreateclient) | Settings passed to Redis |


**NOTES**:

* All modules expose their own `serialize` / `deserialize` properties which defaults to the main properties by default. These are omitted from the above table for brevity
* The default setup for the serialize property assumes no circular references, override this if you really do need to store them - but at a major performance hit
* The MongoDB module does *not* serialize or deserialize by default in order to use its own storage format, set the `serialize` / `deserialize` properties to the main cache object to enable this behaviour



cache.option()
--------------
Alias of `cache.options()`.


cache.init([callback])
----------------------
Initialize the cache handler and attempt to load the modules in preference order.
This function is automatically executed in the constructor if `cache.settings.init` is truthy.
This function returns a promise.


cache.set(Object, [expiry], [callback]) or cache.set(key, value, [expiry], [callback])
--------------------------------------------------------------------------------------
Set a collection of keys or a single key with the optional expiry.
The expiry value can be a date, millisecond offset, moment object or any valid [timestring](https://www.npmjs.com/package/timestring) string.
This function returns a promise.


cache.get(key|keys, [fallback], [callback])
-------------------------------------------
Fetch a single value and call the callback. If the value does not exist the fallback value will be provided.
If called with an array of keys the result is an object with a key/value combination.
Callback is called as `(err, value)`.
This function returns a promise.


cache.unset(key|keys, [callback])
---------------------------------
Release a single or array of keys.
This function returns a promise.


cache.has(key, [callback])
--------------------------
Return whether we have the given key but not actually fetch it.
NOTE: If the individual module does not implement this a simple `get()` will be performed and the return mangled into a boolean. See the compatibility tables at the top of this article to see if 'has' is supported.
This function returns a promise.


cache.size(key, [callback])
---------------------------
Return whether the approximate size in bytes of a cache object.
This function returns a promise.


cache.list(callback)
--------------------
Attempt to return a list of known cache contents.
Callback is called as `(err, items)`.
This function returns a promise.

Each item will have at minimum a `id` and `created` value. All other values (e.g. `expiry`) depend on the cache driver being used.



cache.vacuume([callback])
-------------------------
Attempt to clean up any left over or expired cache entries.
This is only supported by some modules.
This function returns a promise.


cache.destroy([callback])
-------------------------
Politely close all driver resource handles before shutting down.
This function waits for all set operations to complete - even if you didn't attach a callback.
This function returns a promise.


Debugging
=========
This module uses the [debug NPM module](https://github.com/visionmedia/debug) for debugging. To enable set the environment variable to `DEBUG=cache`.

For example:

```
DEBUG=cache node myFile.js
```
