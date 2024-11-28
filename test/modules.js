/**
* Run tests on all available modules, in series
*
* @param {String} [process.env.TEST_MODULES] CSV of specific modules to run, if omitted all are used
*
* @example Test only the Redis + Memory modules
* TEST_MODULES=redis,memory mocha test/modules
*/

import {cloneDeep, random, times} from 'lodash-es';
import Cache from '#cache';
import config from './config.js';
import {expect} from 'chai';
import mlog from 'mocha-logger';

( // Determine which modules to test
	process.env.TEST_MODULES
		? process.env.TEST_MODULES.split(/\s*,\s*/)
		: [
			'filesystem',
			'memory',
			'memcached',
			'mongodb',
			'redis',
			'supabase',
		]
).filter(mod => config[mod].enabled).forEach(mod => {
	describe(`${mod} module`, function() {
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

		it('store simple key/vals (as single setter)', ()=>
			cache.set('foo', 'Foo')
		);

		it('query the size of simple key/vals', function() {
			if (!cache.can('size')) return this.skip();
			return cache.size('foo')
				.then(val => expect(val).to.be.at.least(5))
		});

		it('store simple key/vals (as object)', ()=>
			cache.set({
				bar: 'Bar',
				baz: 'Baz',
			})
		);

		it('restore simple values (foo)', ()=>
			cache.get('foo')
				.then(val => expect(val).to.be.equal('Foo'))
		);

		it('restore simple values (bar)', ()=>
			cache.get('bar')
				.then(val => expect(val).to.be.equal('Bar'))
		);

		it('restore simple values (baz)', ()=>
			cache.get('baz')
				.then(val => expect(val).to.be.equal('Baz'))
		);

		it('restore simple values again (baz)', ()=>
			cache.get('baz')
				.then(val => expect(val).to.be.equal('Baz'))
		);

		it('restore native JS primitives', function() {
			if (config[mod].testSerializer === false) return this.skip();

			let sampleObject = {
				arrays: [[1, 2, 3], [], [[[]]], [-10, 'Hello', Infinity]],
				booleans: [true, false],
				dates: [new Date(), new Date(Date.now() + random(100000, 999999)), new Date(Date.now() - random(100000, 999999))],
				// Functions never compare directly in Mocha for some reason
				//functions: [()=> false, arg => console.log(arg), (a, b, c) => a + b / c],
				nullables: [null, undefined],
				numbers: [0, 123, NaN, Infinity, -Infinity, -5, 928, 312312.312312],
				objects: [{foo: 1, bar: 2, baz: {bazFoo: 3}}, {}, {subKey: [1, 2, {}]}],
				regex: [/./, /^start/, /end$/, /global/g, /multi-global/mg],
				sets: [new Set([1, 2, 3, 10]), new Set()],
				strings: ['', 'a', 'Hello World', '😈🙓😿'],
			};

			return cache.set('testTypes', cloneDeep(sampleObject))
				.then(()=> cache.get('testTypes'))
				.then(val => {
					expect(val).to.deep.equal(sampleObject);
					return cache.unset('testTypes');
				})
		});

		it('restore complex nested objects', ()=> {
			let sampleObject = {
				foo: 'Foo',
				bar: {
					barFoo: random(10000, 99999),
					barBar: 'String-' + random(10000, 99999),
					barBaz: random(1) ? true : false,
				},
				baz: {
					bazFoo: {
						bazFooFoo: 'hello',
						bazFooBar: times(100, ()=> random(10000, 99999)),
						bazFooBaz: {
							bazFooBazFoo: {
								bazFooBazFooFoo: 123,
								bazFooBazFooBar: [1, 2, 3],
							},
						},
					},
				},
			};

			return cache.set('testNested', sampleObject)
				.then(()=> cache[cache.can('size') ? 'size' : 'get']('testNested'))
				.then(val => {
					if (cache.can('size')) expect(val).to.be.at.least(800);
					return cache.get('testNested'); // TODO: We just "get" above, now "get" again; Could simply test in this block
				})
				.then(val => expect(val).to.deep.equal(sampleObject))
				.then(()=> cache.unset('testNested'))
		});

		it('get a list of the current cache IDs', function() {
			if (!cache.can('list')) return this.skip();
			return cache.list()
				.then(res => {
					expect(res).to.be.an('array');
					expect(res).to.have.length.above(2);
					res.forEach(i => {
						expect(i).to.have.property('id');
						expect(i.id).to.be.oneOf([mod + '-foo', mod + '-bar', mod + '-baz']);
					});
				});
		});

		it('unset a single value', ()=>
			cache.set('unFoo', true)
				.then(()=> cache.unset('unFoo'))
				.then(()=> cache.get('unFoo'))
				.then(val => expect(val).to.be.undefined)
		);

		it('unset multiple values', ()=>
			cache.set({unFoo: 'Foo!', unBar: 'Bar!', unBaz: 'Baz!'})
				.then(()=> cache.unset(['unFoo', 'unBar', 'unBaz']))
				.then(()=> cache.get(['unFoo', 'unBar', 'unBaz']))
				.then(vals => expect(vals).to.be.deep.equal({unFoo: undefined, unBar: undefined, unBaz: undefined}))
		);

		it('expire an entry with 100ms', function() {
			if (mod == 'redis') return this.skip(); // Redis doesnt like <1s expire times as of NPM Redis@4.6.6 / Redis Server@7.0.11 - MC 2023-05-10

			return cache.set('quzz', 'Quzz!', new Date(Date.now() + 100))
				.then(()=> new Promise(resolve => setTimeout(resolve, 120)))
				.then(()=> cache.get('quzz'))
				.then(val => expect(val).to.be.undefined)
		});

		it('expire an entry within 1s', ()=>
			cache.set('flarp', 'Flarp!', '1s')
				.then(()=> new Promise(resolve => setTimeout(resolve, 1200)))
				.then(()=> cache.get('flarp!'))
				.then(val => expect(val).to.be.undefined)
		);

		it('to not return non-existant values', ()=>
			cache.get('nonExistant1')
				.then(val => expect(val).to.be.undefined)
		);

		it('to not return non-existant values - with a fallback', ()=>
			cache.get('nonExistant2', 'FALLBACK!')
				.then(val => expect(val).to.be.equal('FALLBACK!'))
		);

		it('to not return non-existant values (using has promise)', ()=>
			cache.has('nonExistant')
				.then(v => expect(v).to.be.equal(false))
		);

		it('to correctly return that it has set values', ()=>
			cache.set('someValue', 'Hello World')
				.then(()=> cache.has('someValue'))
				.then(res => expect(res).to.be.true)
				.then(()=> cache.unset('someValue'))
		);

		it('clean all expired items', function() {
			if (!cache.can('clean')) return this.skip();
			return cache.clean()
				.then(()=> cache.list())
				.then(list => {
					expect(list).to.be.an('array');
					expect(list).to.have.length.above(2); // Three items should still be around, not having expired
				});
		});

		it('clear all items', function() {
			if (!cache.can('clear')) return this.skip();
			return cache.clear();
		});

		it('handle autoCleaning', function(done) {
			if (!cache.can('clean')) return this.skip();
			let fired = {setup: 0, start: 0, end: 0, error: 0};

			let listenSetup = ()=> fired.setup++;
			let listenStart = ()=> fired.start++;
			let listenEnd = ()=> fired.end++;
			let listenError = ()=> fired.error++;

			cache.autoClean(100)
				.on('autoCleanSet', listenSetup)
				.on('autoClean', listenStart)
				.on('autoCleanEnd', listenEnd)
				.on('error', listenError)

			setTimeout(()=> {
				expect(fired).to.be.deep.equal({setup: 1, start: 1, end: 1, error: 0});

				cache
					.off('autoCleanSet', listenSetup)
					.off('autoCleanStart', listenStart)
					.off('autoCleanEnd', listenEnd)
					.off('error', listenError)

				done();
			}, 500);
		});

	});

});
