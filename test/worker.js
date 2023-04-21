import Cache from '../index.js';
import {expect} from 'chai';
import mlog from 'mocha-logger';

describe('cache.worker', ()=> {
	let cache;

	before('setup memory cache', ()=> cache = new Cache({modules: ['memory']}));
	before('init cache', ()=> cache.init())
	before('clear out test contents', ()=> cache.unset('testworker'))

	it('should cache a file from disk', ()=> {

		let reads = 0;
		let worker = ()=> {
			mlog.log('worker call');
			reads++;
			return 123;
		};

		return Promise.resolve()
			.then(()=> cache.worker('testworker', worker))
			.then(v => expect(v).to.equal(123))
			.then(()=> cache.worker('testworker', worker))
			.then(v => expect(v).to.equal(123))
			.then(()=> expect(reads).to.equal(1))
	});

});
