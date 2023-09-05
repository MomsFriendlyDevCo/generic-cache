import BaseCache from './base.js';
import Debug from 'debug';
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
}
