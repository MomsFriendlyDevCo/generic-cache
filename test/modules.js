var _ = require('lodash');
var Cache = require('..');
var expect = require('chai').expect;
var mlog = require('mocha-logger');

[
	'filesystem',
	'memory',
	'memcached',
	'mongodb',
	'redis',
].forEach(mod => {

	describe(`${mod} module`, function() {
		let cache;
		before(()=> {
			this.timeout(5000);
			cache = new Cache({modules: mod, keyMangle: key => 'blah' + key})
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

		it('should store simple key/vals (as single setter)', ()=>
			cache.set('foo', 'Foo')
		);

		it('should query the size of simple key/vals', function() {
			if (!cache.can('size')) return this.skip();
			return cache.size('foo')
				.then(val => expect(val).to.be.at.least(5))
		});

		it('should store simple key/vals (as object)', ()=>
			cache.set({
				bar: 'Bar',
				baz: 'Baz',
			})
		);

		it('should restore simple values (foo)', ()=>
			cache.get('foo')
				.then(val => expect(val).to.be.equal('Foo'))
		);

		it('should restore simple values (bar)', ()=>
			cache.get('bar')
				.then(val => expect(val).to.be.equal('Bar'))
		);

		it('should restore simple values (baz)', ()=>
			cache.get('baz')
				.then(val => expect(val).to.be.equal('Baz'))
		);

		it('should restore simple values again (baz)', ()=>
			cache.get('baz')
				.then(val => expect(val).to.be.equal('Baz'))
		);

		it('should restore native JS primitives', function() {
			if (mod == 'mongodb') return this.skip(); // Mongo doesn't use a serializer so most of the special types will probably fail
			var sampleObject = {
				arrays: [[1, 2, 3], [], [[[]]], [-10, 'Hello', Infinity]],
				booleans: [true, false],
				dates: [new Date(), new Date(Date.now() + _.random(100000, 999999)), new Date(Date.now() - _.random(100000, 999999))],
				// Functions never compare directly in Mocha for some reason
				//functions: [()=> false, arg => console.log(arg), (a, b, c) => a + b / c],
				nullables: [null, undefined],
				numbers: [0, 123, NaN, Infinity, -Infinity, -5, 928, 312312.312312],
				objects: [{foo: 1, bar: 2, baz: {bazFoo: 3}}, {}, {subKey: [1, 2, {}]}],
				regex: [/./, /^start/, /end$/, /global/g, /multi-global/mg],
				sets: [new Set([1, 2, 3, 10]), new Set()],
				strings: ['', 'a', 'Hello World', '😈🙓😿'],
			};

			return cache.set('testTypes', _.cloneDeep(sampleObject))
				.then(()=> cache.get('testTypes'))
				.then(val => {
					expect(val).to.deep.equal(sampleObject);
					return cache.unset('testTypes');
				})
		});

		it('should restore complex nested objects', ()=> {
			var sampleObject = {
				foo: 'Foo',
				bar: {
					barFoo: _.random(10000, 99999),
					barBar: 'String-' + _.random(10000, 99999),
					barBaz: _.random(1) ? true : false,
				},
				baz: {
					bazFoo: {
						bazFooFoo: 'hello',
						bazFooBar: _.times(100, ()=> _.random(10000, 99999)),
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
					return cache.get('testNested');
				})
				.then(val => expect(val).to.deep.equal(sampleObject))
				.then(()=> cache.unset('testNested'))
		});

		it('should get a list of the current cache IDs', function() {
			if (!cache.can('list')) return this.skip();
			return cache.list()
				.then(res => {
					expect(res).to.be.an('array');
					expect(res).to.have.length.above(2);
					res.forEach(i => {
						expect(i).to.have.property('id');
						expect(i.id).to.be.oneOf(['blahfoo', 'blahbar', 'blahbaz']);
					});
				});
		});

		it('should unset a single value', ()=>
			cache.set('unFoo', true)
				.then(()=> cache.unset('unFoo'))
				.then(()=> cache.get('unFoo'))
				.then(val => expect(val).to.be.undefined)
		);

		it('should unset multiple values', ()=>
			cache.set({unFoo: 'Foo!', unBar: 'Bar!', unBaz: 'Baz!'})
				.then(()=> cache.unset(['unFoo', 'unBar', 'unBaz']))
				.then(()=> cache.get(['unFoo', 'unBar', 'unBaz']))
				.then(vals => expect(vals).to.be.deep.equal({unFoo: undefined, unBar: undefined, unBaz: undefined}))
		);

		it('should expire an entry with 100ms', ()=>
			cache.set('quzz', 'Quzz!', new Date(Date.now() + 100))
				.then(()=> new Promise(resolve => setTimeout(resolve, 101)))
				.then(()=> cache.get('quzz'))
				.then(val => expect(val).to.be.undefined)
		);

		it('should expire an entry within 1s', ()=>
			cache.set('flarp', 'Flarp!', '1s')
				.then(()=> new Promise(resolve => setTimeout(resolve, 1200)))
				.then(()=> cache.get('flarp!'))
				.then(val => expect(val).to.be.undefined)
		);

		it('to not return non-existant values', ()=>
			cache.get('nonExistant')
				.then(val => expect(val).to.be.undefined)
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

		it('should clean all expired items', function() {
			if (!cache.can('clean')) return this.skip();
			return cache.clean()
				.then(()=> cache.list())
				.then(list => {
					expect(list).to.be.an('array');
					expect(list).to.have.length.above(2); // Three items should still be around, not having expired
				});
		});

		it('should clear all items', function() {
			if (!cache.can('clear')) return this.skip();
			return cache.clear();
		});

	});

});
