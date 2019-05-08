var Cache = require('..');
var expect = require('chai').expect;

describe('General tests', ()=> {

	it('should fail if asked to load a non-existant module', ()=>
		expect(()=>
			new Cache({modules: 'non-existant'})
				.init()
		).to.throw
	);

});
