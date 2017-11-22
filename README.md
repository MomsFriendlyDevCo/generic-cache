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


cache.vacuume([callback])
-------------------------
Attempt to clean up any left over or expired cache entries.
This is only supported by some modules.
