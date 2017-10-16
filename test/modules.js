var _ = require('lodash');
var Cache = require('..');
var expect = require('chai').expect;

[
	'memory',
	'memcached',
	'mongodb',
].forEach(mod => {

	describe(`${mod} module`, function() {

		var cache;
		before(done => {
			cache = new Cache({modules: mod}, done);
		});

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

		it('should expire an entry within 1.5s', done => {
			cache.set('quzz', 'Quzz!', new Date(Date.now() + 1500), err => {
				expect(err).to.not.be.ok;

				setTimeout(()=> {
					cache.get('quzz', (err, val) => {
						expect(err).to.be.not.ok;
						expect(val).to.be.undefined;

						done();
					});
				}, 1600);
			});
		});

	});

});
