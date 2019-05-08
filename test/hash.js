var Cache = require('..');
var expect = require('chai').expect;

describe('hash()', ()=> {

	var cache;
	before(()=> {
		cache = new Cache({modules: 'memory'});
		return cache.init();
	});

	it('should be able to hash simple values', ()=> {
		expect(cache.hash('foo')).to.be.equal('2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae');
		expect(cache.hash('bar')).to.be.equal('fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9');
		expect(cache.hash('hello world')).to.be.equal('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
	});

	it('should be able to hash complex values', ()=> {
		expect(cache.hash(new Date('2017-01-01'))).to.be.equal('a7eb635331dc3c5ae150db9a09b54fb804420a9d066bff006de11142272be47f');
		expect(cache.hash(['Foo', 'Bar', 'Baz'])).to.be.equal('4fb3bfb3fb1a4a08acaa2b7524722ad65576e488d9168067e5b902d2a9a42882');
		expect(cache.hash({foo: 'Foo!', bar: 'Bar!', baz: 'Baz!'})).to.be.equal('a56c45dc08b2a7ed70189b5bafb92669a1111cbad6da816571e437cdefec13d6');
	});

});
