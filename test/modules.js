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
		before(function(done) {
			this.timeout(5000);
			cache = new Cache({modules: mod, keyMangle: key => 'blah' + key}, done)
				.on('loadedMod', mod => mlog.log('Loaded mod', mod))
				.on('noMods', ()=> {
					mlog.log('Module unavailable');
					this.skip();
				})
		});

		before('clear out existing items', function(done) {
			if (!cache.can('clear')) return done();
			cache.clear(err => {
				expect(err).to.not.be.ok;
				done();
			});
		});

		after(done => cache.destroy(done));

		it('should store simple key/vals (as single setter)', done => {
			cache.set('foo', 'Foo', done);
		});

		it('should store simple key/vals (as object)', done => {
			cache.set({
				bar: 'Bar',
				baz: 'Baz',
			}, done);
		});

		it('should restore simple values (foo)', done => {
			cache.get('foo', (err, val) => {
				expect(err).to.not.be.ok;
				expect(val).to.be.equal('Foo');
				done();
			});
		});

		it('should restore simple values (bar)', done => {
			cache.get('bar', (err, val) => {
				expect(err).to.not.be.ok;
				expect(val).to.be.equal('Bar');
				done();
			});
		});

		it('should restore simple values (baz)', done => {
			cache.get('baz', (err, val) => {
				expect(err).to.not.be.ok;
				expect(val).to.be.equal('Baz');
				done();
			});
		});

		it('should restore simple values again (baz)', done => {
			cache.get('baz', (err, val) => {
				expect(err).to.not.be.ok;
				expect(val).to.be.equal('Baz');
				done();
			});
		});

		it('should restore native JS primitives', function(done) {
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

			cache.set('testTypes', _.cloneDeep(sampleObject), err => {
				if (err) return done(err);
				cache.get('testTypes', (err, val) => {
					if (err) return done(err);
					expect(val).to.deep.equal(sampleObject);
					cache.unset('testTypes', ()=> done());
				});
			});
		});

		it('should restore complex nested objects', done => {
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

			cache.set('testNested', sampleObject, err => {
				if (err) return done(err);
				cache.get('testNested', (err, val) => {
					if (err) return done(err);
					expect(val).to.deep.equal(sampleObject);
					cache.unset('testNested', ()=> done());
				});
			});
		});

		it('should get a list of the current cache IDs', function(done) {
			if (!cache.can('list')) return this.skip();
			cache.list((err, res) => {
				expect(err).to.not.be.ok;
				expect(res).to.be.an('array');
				expect(res).to.have.length(3);
				res.forEach(i => {
					expect(i).to.have.property('id');
					expect(i.id).to.be.oneOf(['blahfoo', 'blahbar', 'blahbaz']);
				});
				done();
			});
		});

		it('should unset values', () => {
			cache.unset('foo', () => {
				cache.get('foo', (err, val) => {
					expect(err).to.not.be.ok;
					expect(val).to.be.undefined;
				});
			});
		});

		it('should expire an entry immediately (date = now)', done => {
			cache.set('quz', 'Quz!', new Date(), err => {
				expect(err).to.not.be.ok;

				cache.get('quz', (err, val) => {
					expect(err).to.be.not.ok;
					expect(val).to.be.undefined;

					done();
				});
			});
		});

		it('should expire an entry with 100ms', done => {
			cache.set('quzz', 'Quzz!', new Date(Date.now() + 100), err => {
				expect(err).to.not.be.ok;

				setTimeout(()=> {
					cache.get('quzz', (err, val) => {
						expect(err).to.be.not.ok;
						expect(val).to.be.undefined;

						done();
					});
				}, 101);
			});
		});

		it('should expire an entry within 1.5s', done => {
			cache.set('flarp', 'Flarp!', new Date(Date.now() + 1500), err => {
				expect(err).to.not.be.ok;

				setTimeout(()=> {
					cache.get('flarp', (err, val) => {
						expect(err).to.be.not.ok;
						expect(val).to.be.undefined;

						done();
					});
				}, 1600);
			});
		});

		it('to not return it has non-existant values', done => {
			cache.has('nonExistant', (err, res) => {
				expect(err).to.not.be.ok;
				expect(res).to.be.false;
				done();
			});
		});

		it('to correctly return it has set values', done => {
			cache.set('someValue', 'Hello World', (err, res) => {
				expect(err).to.not.be.ok;
				cache.has('someValue', (err, res) => {
					expect(err).to.not.be.ok;
					expect(res).to.be.true;
					done();
				});
			});
		});

		it('should vaccume all expired items', function(done) {
			if (!cache.can('vacuume')) return this.skip();
			cache.vacuume(err => {
				expect(err).to.not.be.ok;
				cache.list((err, list) => {
					expect(err).to.not.be.ok;
					expect(list).to.be.an('array');
					expect(list).to.have.length(2); // Two items should still be around, not having expired
					done();
				});
			});
		});


		it('should clear all items', function(done) {
			if (!cache.can('clear')) return this.skip();
			cache.clear(err => {
				expect(err).to.not.be.ok;
				done();
			});
		});

	});

});
