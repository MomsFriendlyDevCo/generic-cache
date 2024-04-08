import BaseCache from './base.js';
import Debug from 'debug';
import {createHash} from 'node:crypto';
import {dirName} from '@momsfriendlydevco/es6';
import fs from 'node:fs/promises';
import fsPath from 'node:path';

const __dirname = dirName();
const debug = Debug('cache');


export default class Cache extends BaseCache {
	getModulePath(mod) {
		let modPath = fsPath.normalize(`${__dirname}/../modules/${mod}.js`);

		// Deal with Windows import weirdness if required
		if (fsPath.sep == '\\' && /^\\\w:\\/.test(modPath)) modPath = `file://${modPath}`;
		return modPath;
	}


	debug(...args) {
		debug(...args);
	}

	/**
	* Helper function to read a local file into the cache
	* Since disk files are (kind of) immutable this function works as both a getter (fetch file contents) and a setter (populate into cache)
	* The file's stats are taken into account when reading so that changed files (filesize + date) get hydrated if needed
	*
	* @param {*} key The key to set
	* @param {string} path The file path to read
	* @param {date|number|string} [expiry] Optional expiry value
	* @returns {Promise<String>} A promise with the UTF-8 contents of the file post-read
	*
	* @emits fromFileRead Emited as `({path, contents})` when a file read occurs both values can be mutated in place
	*/
	fromFile(key, path, expiry) {
		return Promise.resolve()
			.then(()=> Promise.all([
				this.get(key),
				fs.stat(path),
			]))
			.then(([cacheEntry, stats]) => {
				if (
					!cacheEntry // No cache entry - needs reading for the first time
					|| cacheEntry.stats.size != stats.size // Size mismatch
					|| cacheEntry.stats.mtimeMs != stats.mtimeMs // Modified time mismatch
				) { // Create cache entry
					return fs.readFile(path, 'utf8')
						.then(contents => {
							this.debug('read path', path, 'into', key);
							this.emit('fromFileRead', {path, contents});

							return this.set(key, {
								path,
								contents,
								stats,
							}, expiry);
						})
						.then(newEntry => newEntry.contents) // Extract only contents
				} else { // Cache exists and is up to date - just return contents
					return cacheEntry.contents;
				}
			})
			.catch(e => {
				if (e === 'SKIP') return;
				throw e;
			});
	}


	/**
	* ExpressJS / Connect compatible middleware layer to provide caching middleware
	*
	* @param {String|Object} options Options for the eventual middleware. If a string `options.expiry` is assumed
	* @param {String} [options.expiry='5m'] The expiry of the cache item
	* @param {String|Object|Function<String|*>} [options.key] Overriding name (or hashable object) to use as the caching key, if omitted the `hash` method is used to calculate the key instead. If an async function it is run as `(req)`
	* @param {Function<String>} [options.keyMangle] How to mangle the now computed key string into the key that is actually stored within the cache. Defaults to prefixing with `'middleware/'`
	* @param {Function<String|*>} [options.hash] Fallback method if `options.key` is unspecified to hash the incomming request. Defaults to hashing the method, path, query and body
	* @param {Boolean} [options.eTag=true] Whether to generate + obey the eTag http spec. Clients providing a valid eTag will get a 304 response if that tag is still valid
	* @param {Function<String>} [options.hashETag] Async function to generate the client visible eTag from the computed key (post keyMangle)
	* @param {Object} [options.context] Function context used for `key`, `hash` & `cacheFilter` functions if called. Defaults to this cache instance
	* @param {Function<Boolean>} [options.cacheFilter] Async function used to determine whether the output value should be cached when generated. Called as `(req, res, content)` and expected to eventually return a boolean
	* @returns {ExpressMiddleware} An ExpressJS / Connect compatible middleware function
	*/
	middleware(expiry, options) {
		let settings = {
			expiry: expiry || '1h',
			key: null,
			keyMangle: key => `middleware/${key}`,
			hash: req => ({
				method: req.method,
				path: req.path,
				query: req.query,
				body: req.body,
			}),
			eTag: true,
			hashETag: key => createHash('sha1').update(key).digest('base64'),
			context: this,
			cacheFilter: (req, res, content) => true,
			...(typeof options == 'string' ? {expiry: options} : options),
		};

		// Generate the Express middleware function from the above settings
		return (req, res, next) => {
			let keyHash; // Eventual lookup key string to use for the cache (derrived from settings.key || settings.hash(req))
			let eTagHash; // Cyphered version of keyHash to expose to the client

			return Promise.resolve()
				.then(()=>
					typeof settings.key == 'string' ? settings.key // Simple string
					: settings.key && typeof settings.key == 'function' ? settings.key.call(settings.context, req) // Value via function
					: settings.key ? settings.key // Truthy value (could be anything)
					: settings.hash.call(settings.context, req) // Fallback to hash function
				)
				.then(kh => keyHash =
					typeof kh == 'string' ? kh // If a string, use as is
					: this.hash(kh) // Anything else? Run via Cache.hash()
				)
				.then(kh => keyHash = settings.keyMangle(kh))
				.then(()=> Promise.all([
					// Fetch cache value
					this.get(keyHash),

					// Compute hashETag
					settings.eTag && Promise.resolve(settings.hashETag(keyHash))
						.then(het => eTagHash = het),
				]))
				.then(([cacheObj]) => {
					if (req.headers.etag && req.headers.etag == cacheObj.eTag) { // Incomming has eTag hash and it matches - tell client the version they have is already up to date
						res.sendStatus(304);
						throw 'EXIT';
					} else if (cacheObj) { // Client didn't ask for an eTag BUT we have a cached value anyway
						res.type('application/json');
						if (settings.eTag) res.set('etag', eTagHash);
						res.send(cacheObj.content);
						throw 'EXIT';
					} // Implied else - no cached value - need to recompute + set cache contents
				})
				.then(()=> { // Replace the res.json() handler with our own
					let rawJSONHandler = res.json; // Backup "real" Express JSON handler
					res.json = rawContent => Promise.resolve()
						.then(()=> settings.cacheFilter.call(settings.conext, req, res, rawContent))
						.then(canCache => canCache && this.set(
							keyHash,
							{
								eTag: eTagHash,
								content: rawContent,
							},
							settings.expiry
						))
						.then(()=> {
							res.type('application/json');
							if (settings.eTag) res.set('etag', eTagHash);
							rawJSONHandler.call(res, rawContent);
						});

					next(); // Continue Express middleware chain
				})
				.catch(e => {
					if (e !== 'EXIT') throw e;
				})
		};
	}
}
