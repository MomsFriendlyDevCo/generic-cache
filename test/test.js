import Cache from '../index.js';
import {expect} from 'chai';

describe('General tests', ()=> {

	it('should fail if asked to load a non-existant module', ()=>
		expect(()=>
			new Cache({modules: 'non-existant'})
				.init()
		).to.throw
	);

});
