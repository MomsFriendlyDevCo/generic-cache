/**
* Run locking tests on all available modules, in series
*
* @param {String} [process.env.TEST_MODULES] CSV of specific modules to run, if omitted all are used
*
* @example Test only the Redis + Memory modules
* TEST_MODULES=redis,memory mocha test/modules
*/

import {random} from 'lodash-es';
import Cache from '#cache';
import config from './config.js';
import {expect} from 'chai';
import mlog from 'mocha-logger';

( // Determine which modules to test
	process.env.TEST_MODULES
		? process.env.TEST_MODULES.split(/\s*,\s*/)
		: [
			'redis',
		]
).filter(mod => config[mod].enabled).forEach(mod => {
	describe(`${mod} locking`, function() {
		let cache;
		before(()=> {
			this.timeout(5000);
			// NOTE: This instance may report things known by other instance. Using "mod" in key restricts it to own items
			cache = new Cache({
				modules: mod,
				keyMangle: key => mod + '-' + key,
				...config,
			})
				.on('loadedMod', mod => mlog.log('Loaded mod', mod))
				.on('noMods', ()=> {
					mlog.log('Module unavailable');
				})

			return cache.init();
		});

		before('clear out existing items', ()=> {
			if (!cache.can('clear')) return;
			return cache.clear();
		});

		after(()=> cache.destroy());

		it('should handle a simple locking session', function() {
			if (!cache.can('lock')) return this.skip();
			return cache.lockAquire('test-lock')
				.then(res => expect(res).to.be.true)
				.then(()=> cache.lockExists('test-lock'))
				.then(res => expect(res).to.be.true)
				.then(()=> cache.lockRelease('test-lock'))
				.then(res => expect(res).to.be.true)
				.then(()=> cache.lockExists('test-lock'))
				.then(res => expect(res).to.be.false)
		});


		it('should handle expiring locks', function() {
			if (!cache.can('lock')) return this.skip();
			return cache.lockAquire('test-lock-expiry', '100ms')
				.then(res => expect(res).to.be.true)
				.then(()=> new Promise(resolve => setTimeout(resolve, 100)))
				.then(()=> cache.lockAquire('test-lock-expiry', '10m'))
				.then(res => expect(res).to.be.true)
				.then(()=> cache.lockExists('test-lock-expiry'))
				.then(res => expect(res).to.be.true)
				.then(()=> cache.lockRelease('test-lock-expiry'))
				.then(res => expect(res).to.be.true)
		});

		it('should handle lock conflicts', function() {
			if (!cache.can('lock')) return this.skip();
			return cache.lockAquire('test-lock-conflict')
				.then(res => expect(res).to.be.true)
				.then(()=> cache.lockAquire('test-lock-conflict'))
				.then(res => expect(res).to.be.false)
		});

		it('should randomly create and destroy locks', function() {
			this.timeout(10 * 1000);
			let stats = {clashes: 0, created: 0};
			let created = new Set();
			let create = ()=> new Promise((resolve, reject) => {
				var id = 'lock-' + random(1, 9);
				cache.lockAquire(id)
					.then(res => {
						if (res === false) { // Correct response - detected clash
							stats.clashes++;
						} else if (!created.has(id) && res === true) { // Correct response - no clash
							stats.created++;
						}
						resolve();
					})
					.catch(reject)
			});

			return Promise.all(Array.from(new Array(100)).map(()=> create()))
				.then(()=> mlog.log('Created', stats.created, 'locks with', stats.clashes, 'clashes'))
		});

		it('should spin-lock', async function() {
			this.timeout(10 * 1000);
			var key = {foo: 1, bar: 2};

			// Allocate initial lock + expiry after 1 second
			await cache.lockAquire(key, '1s');

			return cache.lockSpin(key, { // Default rules are to retry 5 times with 250ms between each
				onLocked: (attempt, max, settings) => mlog.log(`Try unlocking "${settings.key}" [${attempt}/${max}]`),
			})
		});

	});

});
