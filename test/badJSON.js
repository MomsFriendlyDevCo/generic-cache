var _ = require('lodash');
var Cache = require('..');
var expect = require('chai').expect;
var fs = require('fs');
var fspath = require('path');
var os = require('os');

describe('Bad JSON data', function() {

	var cache;
	before(()=> {
		cache = new Cache({
			modules: ['filesystem'],
			path: (key, val, expiry, cb) => path.join(os.tmpdir(), 'cache', `${key}.cache.json`),
			pathSwap: (key, val, expiry, cb) => path.join(os.tmpdir(), 'cache', `${key}.cache.swap.json`),
			pathList: cb => cb(null, fspath.join(os.tmpdir(), 'cache')),
			pathFilter: (file, cb) => cb(null, file.endsWith('.cache.json')),
			pathId: (file, cb) => cb(null, fspath.basename(file, '.cache.json')),
		})

		return cache.init();
	});

	before('clear out existing items', ()=> {
		if (!cache.can('clear')) return;
		return cache.clear();
	});

	before('setup bad JSON contents', ()=> Promise.resolve()
		.then(()=> fs.promises.writeFile( // Write bad JSON file contents
			fspath.join(os.tmpdir(), 'cache', 'badjson.cache.json'),
			'this is bad JSON content'
		))
		.then(()=> fs.promises.utimes( // Set the file date in the future so it doesn't count as expiring
			fspath.join(os.tmpdir(), 'cache', 'badjson.cache.json'),
			new Date('2050-01-01'),
			new Date('2050-01-01'),
		))
	)

	after(()=> cache.destroy());

	it('attempting to read bad JSON data should throw', ()=>
		cache.get('badjson')
			.then(()=> expect.fail)
			.catch(e => expect(e).to.match(/Error parsing JSON file "(?<path>.*?)" - (?<error>.*)$/))
	);

});
