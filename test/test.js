var Cache = require('..');
var cacheConfig = require('./config');
var expect = require('chai').expect;

describe('Basic caching', function() {

	var cache;
	before(done => {
		cache = new Cache(cacheConfig, done);
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

	it('should expire an entry immediately', done => {
		cache.set('quz', 'Quz!', new Date(), err => {
			expect(err).to.not.be.ok;

			cache.get('quz', (err, val) => {
				expect(err).to.be.not.ok;
				expect(val).to.be.undefined;

				done();
			});
		});
	});

});
