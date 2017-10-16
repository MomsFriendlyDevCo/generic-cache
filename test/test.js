var Cache = require('..');
var expect = require('chai').expect;

describe('General tests', ()=> {

	it('should fail if asked to load a non-existant module', done => {
		new Cache({modules: 'non-existant'}, err => {
			expect(err).to.be.ok;
			done();
		});
	});

});
