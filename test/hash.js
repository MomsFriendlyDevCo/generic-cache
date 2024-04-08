import Cache from '#cache';
import {expect} from 'chai';

describe('hash()', ()=> {

	let cache;
	before(()=> {
		cache = new Cache({modules: 'memory'});
		return cache.init();
	});

	it('should be able to hash simple values', ()=> {
		expect(cache.hash('foo')).to.be.equal('fNPtrMTJ3UOQgXdQjBEmCKOYu5o=');
		expect(cache.hash('bar')).to.be.equal('ig3TOYkCrxNtAuL+5a0NchAy81k=');
		expect(cache.hash('hello world')).to.be.equal('9+tGPOdZ/kNA+DsL9/RJPTo6OcI=');
	});

	it('should be able to hash complex values', ()=> {
		expect(cache.hash(new Date('2017-01-01'))).to.be.equal('6KjgGfhE8SqkUrbtu8mXmy8sZLs=');
		expect(cache.hash(['Foo', 'Bar', 'Baz'])).to.be.equal('TsJlmwbrRXdxwh0PS9cCySs5A64=');
		expect(cache.hash({foo: 'Foo!', bar: 'Bar!', baz: 'Baz!'})).to.be.equal('dJBkol9e+C6lQomYzfPtw62fYBM=');
	});

});
