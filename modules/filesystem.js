import {defaultsDeep} from 'lodash-es';
import fs from 'node:fs';
import fsPath from 'node:path';
import os from 'node:os';

export default function(settings, cache) {
	let driver = {};

	driver.settings = defaultsDeep(settings, {
		filesystem: {
			fallbackDate: new Date('2500-01-01'),
			path: key => fsPath.join(os.tmpdir(), 'cache', key + '.cache.json'),
			pathSwap: key => fsPath.join(os.tmpdir(), 'cache', key + '.cache.swap.json'),
			pathList: ()=> fsPath.join(os.tmpdir(), 'cache'),
			pathFilter: file => file.endsWith('.cache.json'),
			pathId: file => fsPath.basename(file, '.cache.json'),
			serialize: cache.settings.serialize,
			deserialize: cache.settings.deserialize,
			moveFailTries: 30,
			moveFailInterval: 100,
			utimeFailTries: 30,
			utimeFailInterval: 100,
		},
	});

	driver.canLoad = ()=> true; // Filesystem module is always available

	driver.set = (key, val, expiry) => {
		let path, pathSwap;

		return Promise.resolve()
			.then(()=> Promise.all([
				Promise.resolve(driver.settings.filesystem.path(key, val, expiry))
					.then(res => path = res)
					.then(()=> fs.promises.mkdir(fsPath.dirname(path), {recursive: true})),

				Promise.resolve(driver.settings.filesystem.pathSwap(key, val, expiry))
					.then(res => pathSwap = res)
					.then(()=> fs.promises.mkdir(fsPath.dirname(pathSwap), {recursive: true})),
			]))
			.then(()=> fs.promises.writeFile(pathSwap, settings.filesystem.serialize(val)))
			.then(()=> new Promise((resolve, reject) => {
				let tryCount = 0; // Number of times we have waited for the file to Utime successfully
				let tryUtime = ()=> fs.promises.utimes(pathSwap, new Date(), expiry || driver.settings.filesystem.fallbackDate)
					.then(()=> {
						if (tryCount > 0) console.warn(`CACHE: Took ${tryCount} attempts to UTime the swapfile`);
						resolve();
					})
					.catch(e => {
						if (++tryCount >= driver.settings.utimeFailTries) reject(`Failed to UTime the swap file after max of ${driver.utimeFailTries} times - ${e.toString()}`);
						setTimeout(tryUtime, driver.settings.utimeFailInterval); // Schedule next attempt
					})

				tryUtime(); // Kick off initial attempt to utime the file
			}))
			.then(()=> fs.promises.unlink(path).catch(()=> null)) // Delete original and purposely ignore errors - original file probably didn't exist in the first place
			.then(()=> new Promise((resolve, reject) => {
				// BUGFIX: There is some weird sync issue with node where the file isn't flushed to disk so it can't be moved until it exists
				//         This seems to be rare but nonetheless we have to keep checking for its existance before we can move give up
				let tryCount = 0; // Number of times we have waited for the file to move successfully
				let tryMove = ()=> fs.promises.rename(pathSwap, path) // Move the swap file over the original path
					.then(()=> {
						if (tryCount > 0) console.warn(`CACHE: Took ${tryCount} attempts to move swapfile over live file`);
						resolve();
					})
					.catch(e => {
						if (++tryCount >= driver.settings.moveFailTries) reject(`Failed to move swap file max of ${driver.moveFailTries} times - ${e.toString()}`);
						setTimeout(tryMove, driver.settings.moveFailInterval); // Schedule next attempt
					})

				tryMove(); // Kick off initial attempt to move the file
			}))
	};

	driver.get = function(key, fallback) {
		let path;

		return Promise.resolve(driver.settings.filesystem.path(key, null, null))
			.then(res => path = res)
			.then(()=> fs.promises.stat(path).catch(()=> null))
			.then(stats => {
				if (!stats) { // No stats - no file to read
					return false;
				} else if (stats.mtime < new Date()) { // Modified date is in the past - the file has expired
					return fs.promises.unlink(path) // Delete the file then respond that it has expired
						.then(()=> false)
						.catch(()=> false)
				} else {
					return true;
				}
			})
			.then(isValid => isValid
				? fs.promises.readFile(path)
					.then(buf => settings.filesystem.deserialize(buf))
					.catch(e => {
						throw new Error(`Error parsing JSON file "${path}" - ${e.toString()}`);
					})
				: fallback
			)
	};

	driver.unset = key =>
		Promise.resolve(driver.settings.filesystem.path(key, null, null))
			.then(path => fs.promises.unlink(path)) // Delete file - ignoring errors
			.catch(()=> undefined);

	driver.has = key =>
		Promise.resolve(driver.settings.filesystem.path(key, null, null))
			.then(path => fs.promises.stat(path).catch(()=> false)) // Try to fetch stats, ignoring missing file
			.then(stats =>
				stats // stats valid - file exists
				&& stats.mtime >= new Date() // Modified date is in the future - the file has not expired
			);

	driver.size = key =>
		Promise.resolve(driver.settings.filesystem.path(key, null, null))
			.then(path => fs.promises.stat(path).catch(()=> false)) // Get stats igoring missing files
			.then(stats => {
				if (
					!stats // No stats - no file to read
					|| stats.mtime < new Date() // Modified date is in the past - the file has expired
				) {
					return undefined;
				} else {
					return stats.size;
				}
			});

	driver.list = ()=> {
		let rootPath;

		return Promise.resolve(driver.settings.filesystem.pathList())
			.then(res => rootPath = res)
			.then(()=> fs.promises.readdir(rootPath).catch(()=> []))
			.then(files => Promise.all(files.map(file =>
				Promise.resolve(driver.settings.filesystem.pathFilter(file))
					.then(isValid => isValid ? Promise.resolve(driver.settings.filesystem.pathId(file)) : false)
					.then(id => id
						? fs.promises.stat(fsPath.join(rootPath, file))
							.then(stats => {
								if (stats.mtime < new Date()) return false; // Filter out expired items
								stats.id = id;
								return stats;
							})
						: false
					)
					.then(stats => stats
						? ({
							id: stats.id,
							created: stats.ctime,
							expiry: stats.mtime,
						})
						: false
					)
			)))
			.then(ids => ids.filter(id => id)); // Remove dud ID's
	};

	driver.destroy = ()=> {};

	return driver;
}
