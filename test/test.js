import Cache from '#cache';
import {expect} from 'chai';

describe('General tests', ()=> {

	it('fail if asked to load a non-existant module', ()=>
		expect(()=>
			new Cache({modules: 'non-existant'})
				.init()
		).to.throw
	);

});
