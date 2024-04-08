@momsfriendlydevco/cache
========================
Generic caching component.

This module is a low-level caching component designed to store, retrieve, expire and cleanup a simple key-value storage.

Features:

* Fully ES6 + promise compliant
* Isomorphic back-end (Node) + front-end (Browser) support - just import and use
* Module support for most main caching systems
* Expiry based storage for all setters / getters
* Automatic cleaning
* Function wrapping and memorization support (via `cache.worker()`)
* File contents caching (via `cache.fromFile()`, Node only)

```javascript
import Cache from '@momsfriendlydevco/cache';

const storage = new Cache({
	modules: ['memcached', 'mongo', 'memory'], // What modules to try to load (in order of preference)
	// module: 'redis', // Or just specify one
});


// Setup the first available caching system
await storage.init();


// Set something (key, val, [expiry])
storage.set('myKey', 'myValue', '1h').then(setVal => ...)

// Get something (key, [fallback])
storage.get('myKey', 'fallbackValue').then(val => ...)

// Forget something (key)
storage.unset('myKey').then(()=> ...)

// Clean up storage, only supported by some modules
storage.clean().then(()=> ...)

// Hash something, objects also supported
storage.hash(complexObject, val => ...)
```

All methods return a promise.


Supported Caching Drivers
=========================

| Driver       | Requires         | Maximum object size | Serializer | list() | has() | size() | clean() | lock*() |
|--------------|------------------|---------------------|------------|--------|-------|--------|---------|---------|
| filesystem   | Writable FS area | Infinite            | Yes        | Yes    | Yes   | Yes    |         |         |
| memcached    | MemcacheD daemon | 1mb                 | Yes        |        |       |        |         |         |
| memory       | Nothing          | Infinite            | Not needed | Yes    | Yes   | Yes    | Yes     |         |
| mongodb      | MongoDB daemon   | 16mb                | Disabled   | Yes    | Yes   |        | Yes     |         |
| redis        | Redis daemon     | 512mb               | Yes        | Yes    | Yes   | Yes    |         | Yes     |
| supabase     | Supabase account | Infinite            | Disabled   | Yes    | Yes   |        | Yes     |         |
| localstorage | Browser          | Infinite            | Yes        | Yes    | Yes   | Yes    | Yes     |         |


**NOTES**:

* By default MemcacheD caches 1mb slabs, see the documentation of the daemon to increase this
* While memory storage is theoretically infinite Node has a memory limit of 1.4gb by default. See the node CLI for details on how to increase this
* Some caching systems (notably MemcacheD) automatically clean entries
* For most modules the storage values are encoded / decoded via [marshal](https://github.com/MomsFriendlyDevCo/marshal). This means that complex JS primitives such as Dates, Sets etc. can be stored without issue. This is disabled in the case of MongoDB by default but can be enabled if needed
* When `has()` querying is not supported by the module a `get()` operation will be performed and the result mangled into a boolean instead, this ensures that all modules support `has()` at the expense of efficiency
* The localstorage module is only only available on the browser release
* The Supabase module by default requires a simple key=>jsonb table setup with a created + expires column. The simplest definition of this would be `create table cache (id character varying not null, created_at timestamp with time zone null default now(), expires_at timestamp with time zone null, data jsonb null, constraint cache_pkey primary key (id))`


API
===


Cache([options]) (constructor)
------------------------------
Create a new cache handler and populate its default options.

Note that `cache.init()` needs to be called and needs to complete before this module is usable.


cache.options(Object) or cache.options(key, val)
------------------------------------------------
Set lots of options in the cache handler all at once or set a single key (dotted or array notation are supported).


Valid options are:

| Option                         | Type           | Default                                                                            | Description                                                                                 |
|--------------------------------|----------------|------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| `init`                         | Boolean        | `true`                                                                             | Whether to automatically run cache.init() when constructing                                 |
| `cleanInit`                    | Boolean        | `false`                                                                            | Run `clean()` in the background on each init                                                |
| `cleanAuto`                    | Boolean        | `false`                                                                            | Run `autoClean()` automatically in the background on init                                   |
| `cleanAutoInterval`            | String         | `"1h"`                                                                             | Timestring to use when rescheduling `autoClean()`                                           |
| `keyMangle`                    | Function       | `key => key`                                                                       | How to rewrite the requested key before get / set / unset operations                        |
| `modules`                      | String / Array | `['memory']` / `'memory'`                                                          | What module(s) to attempt to load                                                           |
| `module`                       | String / Array | `['memory']` / `'memory'`                                                          | Alternate spelling of `modules`                                                             |
| `serialize`                    | Function       | `marshal.serialize`                                                                | The serializing function to use when storing objects                                        |
| `deserialize`                  | Function       | `marshal.deserialize`                                                              | The deserializing function to use when restoring objects                                    |
| `filesystem`                   | Object         | See below                                                                          | Filesystem module specific settings                                                         |
| `filesystem.fallbackDate`      | Date           | `2500-01-01`                                                                       | Fallback date to use as the filesystem expiry time                                          |
| `filesystem.memoryFuzz`        | Number         | `200`                                                                              | How many Milliseconds bias to use when comparing the file ctime to the memory creation date |
| `filesystem.moveFailTries`     | Number         | `30`                                                                               | Maximum number of tries before giving up moving swap files over live files                  |
| `filesystem.moveFailInterval`  | Number         | `100`                                                                              | Delay between retries                                                                       |
| `filesystem.utimeFailTries`    | Number         | `30`                                                                               | Maximum number of tries before giving up setting the utime on the swap file                 |
| `filesystem.utimeFailInterval` | Number         | `100`                                                                              | Delay between retries                                                                       |
| `filesystem.path`              | Function       | os.tempdir + key + '.cache.json'                                                   | How to calculate the file path to save. Defaults to the OS temp dir                         |
| `filesystem.pathSwap`          | Function       | " + " + '.cache.swap.json'                                                         | How to calculate the swap path to save. Defaults to the OS temp dir                         |
| `memcached`                    | Object         | See below                                                                          | MemcacheD module specific settings                                                          |
| `memcached.server`             | String         | `'127.0.0.1:11211'`                                                                | The MemcacheD server address to use                                                         |
| `memcached.lifetime`           | Number         | `1000*60` (1h)                                                                     | The default expiry time, unless otherwise specified                                         |
| `memcached.options`            | Object         | `{retries:1,timeout:250}`                                                          | Additional options passed to the MemcacheD client                                           |
| `mongodb`                      | Object         | See below                                                                          | MongoDB module specific options                                                             |
| `mongodb.uri`                  | String         | `'mongodb://localhost/mfdc-cache'`                                                 | The MongoDB URI to connect to                                                               |
| `mongodb.collection`           | String         | `mfdcCaches`                                                                       | The collection to store cache information within                                            |
| `mongodb.options`              | Object         | See code                                                                           | Additional Mongo options to use when connecting                                             |
| `redis`                        | Object         | [See Redis module settings](https://www.npmjs.com/package/redis#rediscreateclient) | Settings passed to Redis                                                                    |
| `supabase`                     | Object         |                                                                                    | See below                                                                                   | Supabase config |
| `supabase.uri`                 | String         | `null`                                                                             | The Supabase URL to communicate with                                                        |
| `supabase.apikey`              | String         | `null`                                                                             | The Supabase API key to use                                                                 |
| `supabase.options`             | Object         | `{}`                                                                               | Additional options to pass during the connection                                            |
| `supabase.table`               | String         | `'cache'`                                                                          | The caching table to use                                                                    |
| `supabase.colId`               | String         | `'id'`                                                                             | The column ID to use (should be an indexed key)                                             |
| `supabase.colData`             | String         | `'data'` The JSONB column used to stash data                                       |


**NOTES**:

* All modules expose their own `serialize` / `deserialize` properties which defaults to the main properties by default. These are omitted from the above table for brevity
* The default setup for the serialize property assumes no circular references, override this if you really do need to store them - but at a major performance hit
* The MongoDB module does *not* serialize or deserialize by default in order to use its own storage format, set the `serialize` / `deserialize` properties to the main cache object to enable this behaviour
* `filesystem.moveFailTries` is necessary because on some systems writing the temporary swap file, setting its expiry then trying to move it over the live file sometimes fails. TO work around this we wait for the filesystem to flush the maximum number of times with a delay in between.



cache.option()
--------------
Alias of `cache.options()`.


cache.init()
------------
Initialize the cache handler and attempt to load the modules in preference order.
This function is automatically executed in the constructor if `cache.settings.init` is truthy.
This function returns a promise.


cache.autoClean(newInterval)
----------------------------
Setup a time to clean out all expired cache items.
If no interval is provided the option `autoCleanInterval` is used.
If the interval is falsy the timer is disabled.


cache.set(Object, [expiry]) or cache.set(key, value, [expiry])
--------------------------------------------------------------------------------------
Set a collection of keys or a single key with the optional expiry.
The expiry value can be a date, millisecond offset, moment object or any valid [timestring](https://www.npmjs.com/package/timestring) string.
This function returns a promise.


cache.get(key|keys)
-------------------------------------------
Fetch a single / multiple values. If the value does not exist the fallback value will be provided.
If called with an array of keys the result is an object with a key/value combination.
This function returns a promise.


cache.unset(key|keys)
---------------------------------
Release a single or array of keys.
This function returns a promise.


cache.has(key)
--------------------------
Return whether we have the given key but not actually fetch it.
NOTE: If the individual module does not implement this a simple `get()` will be performed and the return mangled into a boolean. See the compatibility tables at the top of this article to see if 'has' is supported.
This function returns a promise.


cache.size(key)
---------------------------
Return whether the approximate size in bytes of a cache object.
This function returns a promise.


cache.list()
------------
Attempt to return a list of known cache contents.
This function returns a promise.

Each item will have at minimum a `id` and `created` value. All other values (e.g. `expiry`) depend on the cache driver being used.



cache.clean()
-------------
Attempt to clean up any left over or expired cache entries.
This is only supported by some modules.
This function returns a promise.


cache.destroy()
---------------
Politely close all driver resource handles before shutting down.
This function waits for all set operations to complete before resolving.
This function returns a promise.


cache.lockAquire(key, expiry)
-----------------------------
Request the creation of a unique lock specified by the hashed version of the key (with an optional expiry).
This function returns a promise with a boolean indicating if the lock aquire was successful.


cache.lockRelease(key)
----------------------
Release an aquired lock.
This function returns a promise.


cache.lockExists(key)
---------------------
Query the status of a lock.
This function returns a promise with a boolean indicating if the lock exists.


cache.lockSpin(key, options)
----------------------------
Returns a Promise which repeatedly checks if a key exists a given number of times (with configurable retires / backoff).
If the key is eventually available, it is created otherwise this function throws.

Options are:

| Option        | Type       | Default | Description                                                                                                                                                                         |
|---------------|------------|---------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `expiry`      | TimeString |         | Optional expiry for the lock                                                                                                                                                        |
| `retries`     | `Number`   | `5`     | Maximum number of retries to attempt                                                                                                                                                |
| `delay`       | `Number`   | `250`   | Time in milliseconds to wait for a lock using the default backoff system                                                                                                            |
| `create`      | `Boolean`  | `true`  | If a lock can be allocated, auto allocate it before resuming                                                                                                                        |
| `backoff`     | `Function` |         | Function to calculate timing backoff, should return the delay to use. Called as `(attempt, max, settings)`. Defaults to simple linear backoff using `delay` + some millisecond fuzz |
| `onLocked`    | `Function` |         | Async function to call each time a lock is detected. Called as `(attempt, max, settings)`                                                                                           |
| `onCreate`    | `Function` |         | Async function to call if allocating a lock is successful. Called as `(attempt, max, settings)`                                                                                     |
| `onExhausted` | `Function` |         | Async function to call if allocating a lock failed after multiple retries. Called as `(attempt, max, settings)`. Should throw                                                       |


cache.fromFile(key, path, expiry)
---------------------------------
Helper function to read a local file into the cache
Only available within NodeJS.
Since disk files are (kind of) immutable this function works as both a getter (fetch file contents) and a setter (populate into cache)
The file's stats are taken into account when reading so that changed files (filesize + date) get hydrated if needed
This function returns a promise with the cached files contents.


cache.middleware(expiry, options)
---------------------------------
ExpressJS / Connect compatible middleware layer to provide caching middleware.
Returns an ExpressJS / Connect middleware function.
Only available within NodeJS.

Expiry is optional but if provided as a string is assumed to populate `options.expiry`.

Options are:

| Option        | Type                                 | Default      | Description                                                                                                                                                                  |
|---------------|--------------------------------------|--------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `expiry`      | `String`                             | `'5m'`       | The expiry of the cache item
| `key`         | `String`, `Object`, `Function<String|*>` |          |Overriding name (or hashable object) to use as the caching key, if omitted the `hash` method is used to calculate the key instead. If an async function it is run as `(req)` |
| `keyMangle`   | `Function<String>`                   |              | How to mangle the now computed key string into the key that is actually stored within the cache. Defaults to prefixing with `'middleware/'`                                  |
| `hash`        | `Function<String|*>`                 |              | Fallback method if `options.key` is unspecified to hash the incomming request. Defaults to hashing the method, path, query and body                                          |
| `eTag`        | `Boolean`                            | `true`       | Whether to generate + obey the eTag http spec. Clients providing a valid eTag will get a 304 response if that tag is still valid                                             |
| `hashETag`    | `Function<String>`                   | SHA1 w/Bas64 | Async function to generate the client visible eTag from the computed key (post keyMangle)                                                                                    |
| `context`     | `Object`                             | `Cache`      | Function context used for `key`, `hash` & `cacheFilter` functions if called. Defaults to this cache instance                                                                 |
| `cacheFilter` | `Function`                           | `()=>true`   | Async function used to determine whether the output value should be cached when generated. Called as `(req, res, content)` and expected to eventually return a boolean       |


cache.worker(options, worker)
-----------------------------
Simple wrapper middleware function which either returns the cached ID or runs a worker to calculate + cache a new one.
NOTE: Since Promise execute immediately the worker must be a promise factory

Options can either be a string (assumed as `options.id`) or an object made up of:

| Option         | Type                  | Default     | Description                                                                                                                                                                                                                                                                                       |
|----------------|-----------------------|-------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `id`           | `String`              |             | The ID of the cache to use                                                                                                                                                                                                                                                                        |
| `enabled`      | `Boolean`             | `true`      | Whether to use the cache at all, set to false to debug the function worker each time                                                                                                                                                                                                              |
| `expiry`       | `String`              | `"1h"`      | Any timesting valid entry to determine the maximum cache time                                                                                                                                                                                                                                     |
| `rejectAs`     | `Boolean`             | `undefined` | Cache throwing promises as this value rather than repeating them each hit                                                                                                                                                                                                                         |
| `retry`        | `Number`              | `0`         | If a promise rejects retry it this many times before giving up                                                                                                                                                                                                                                    |
| `retryDelay`   | `Number` / `Function` | `100`       | Delay between promise retries, if a function is called as `(attempt, settings)` and expected to return the delay amount                                                                                                                                                                           |
| `onCached`     | `Function`            |             | Sync function to called as `(settings, value)` when using a valid cached value instead of hydrating the worker, if any value except `undef` is returned it is used as the returned value                                                                                                          |
| `onRetry`      | `Function`            |             | Sync function to call as `(error, attempt)` when a retryable operation fails, if any non-undefined is returned the retry cycle is aborted and the value used as the promise resolve value, if the function throws the entire promise retry cycle is exited with the thrown error as the rejection |
| `invalidStore` | `*`                   |             | Value use to detect the absence of a value in the cache (so we can detect null/undefined values even though they are falsy)                                                                                                                                                                       |


Debugging
=========
This module uses the [debug NPM module](https://github.com/visionmedia/debug) for debugging. To enable set the environment variable to `DEBUG=cache`.

For example:

```
DEBUG=cache node myFile.js
```
