import Cache from '#cache';
import {expect} from 'chai';

describe('promise test', ()=> {

	let cache;
	before(()=> {
		cache = new Cache({modules: 'memory'});
		return cache.init();
	})

	before('clear out existing items', ()=> cache.clear());

	after(()=> cache.destroy());

	it('be able to set a simple value', ()=>
		cache.set('promiseFoo', 'Foo!')
	);

	it('be able to set an object value', ()=>
		cache.set({promiseBar: 'Bar!', promiseBaz: 'Baz!'})
	);

	it('be able to restore simple values', ()=>
		cache.get('promiseFoo')
			.then(val => expect(val).to.equal('Foo!'))
	);

	it('be able to restore object values', ()=>
		Promise.all([
			cache.get('promiseBar'),
			cache.get('promiseBaz'),
		])
		.then(values => expect(values).to.deep.equal(['Bar!', 'Baz!']))
	);

	it('be able to unset values', ()=>
		cache.unset('promiseBar')
			.then(()=> cache.get('promiseBar'))
			.then(v => expect(v).to.not.be.ok)
	)

	it('be able to clear all items', ()=>
		cache.clear()
			.then(()=> cache.get('promiseBaz'))
			.then(v => expect(v).to.be.undefined)
	);

});
