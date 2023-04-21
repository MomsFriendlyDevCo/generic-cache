import Cache from '#cache';
import {expect} from 'chai';
import fs from 'node:fs';
import fsPath from 'node:path';
import os from 'node:os';

describe('Bad JSON data', function() {

	let cache;
	before(()=> {
		cache = new Cache({
			modules: ['filesystem'],
			path: key => fsPath.join(os.tmpdir(), 'cache', `${key}.cache.json`),
			pathSwap: key => fsPath.join(os.tmpdir(), 'cache', `${key}.cache.swap.json`),
			pathList: ()=> fsPath.join(os.tmpdir(), 'cache'),
			pathFilter: file => file.endsWith('.cache.json'),
			pathId: file => fsPath.basename(file, '.cache.json'),
		})

		return cache.init();
	});

	before('clear out existing items', ()=> {
		if (!cache.can('clear')) return;
		return cache.clear();
	});

	before('setup bad JSON contents', ()=> Promise.resolve()
		.then(()=> fs.promises.writeFile( // Write bad JSON file contents
			fsPath.join(os.tmpdir(), 'cache', 'badjson.cache.json'),
			'this is bad JSON content'
		))
		.then(()=> fs.promises.utimes( // Set the file date in the future so it doesn't count as expiring
			fsPath.join(os.tmpdir(), 'cache', 'badjson.cache.json'),
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
