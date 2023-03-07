var Cache = require('..');
var expect = require('chai').expect;
var mlog = require('mocha-logger');

describe('cache.fromFile', ()=> {
	let cache;

	before('setup memory cache', ()=> cache = new Cache({modules: ['memory']}));
	before('init cache', ()=> cache.init())
	before('clear out test contents', ()=> cache.unset('testfile'))

	it('should cache a file from disk', ()=> {

		let reads = 0;
		cache.on('fromFileRead', ({path}) => {
			mlog.log('read', path);
			reads++;
		});

		return Promise.resolve()
			.then(()=> cache.fromFile('testfile', __filename))
			.then(contents => expect(contents).to.match(/^var Cache = /))
			.then(()=> cache.fromFile('testfile', __filename))
			.then(contents => expect(contents).to.match(/^var Cache = /))
			.then(()=> expect(reads).to.equal(1))
	});

});
