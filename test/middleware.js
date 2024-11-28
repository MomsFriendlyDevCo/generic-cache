import axios from 'axios';
import bodyParser from 'body-parser';
import Cache from '#cache';
import {expect} from 'chai';
import express from 'express';
import expressLogger from 'express-log-url';
import {random} from 'lodash-es';

let server;

let port = 8181;
let url = 'http://localhost:' + port;

describe('Middleware', ()=> {

	let app;
	let cache;

	before('setup cache', ()=> cache = new Cache());
	before('init cache', ()=> cache.init())

	// Express Setup {{{
	before('server setup', function(finish) {
		this.timeout(10 * 1000);

		app = express();
		app.set('log.indent', '      ');
		app.use(expressLogger);
		app.use(bodyParser.json());

		app.get('/cache/ok', (req, res) => res.sendStatus(200));

		app.get('/cache/100ms', cache.middleware('100ms'), (req, res) => {
			res.send({random: random(0, 99999999)});
		});

		app.get('/cache/1s', cache.middleware('1s'), (req, res) => {
			res.send({random: random(0, 99999999)});
		});

		app.get('/cache/2s', cache.middleware('2 seconds'), (req, res) => {
			res.send({random: random(0, 99999999)});
		});

		app.get('/cache/3000ms', cache.middleware('3000ms'), (req, res) => {
			res.send({random: random(0, 99999999)});
		});

		app.get('/cache/marshal', cache.middleware('3000ms'), (req, res) => {
			res.send({
				random: random(0, 99999999),
				2024: new Date('2024-01-01'),
				boolTrue: true,
				undef: undefined,
				set: new Set(['Foo', 'Bar', 'Baz']),
			});
		});

		app.get('/cache/customKey/:key', cache.middleware('1h', {key: req => req.params.key}), (req, res) => {
			res.send({
				key: req.params.key,
				random: random(0, 99999999),
			});
		});

		app.get('/cache/selective/:code', cache.middleware('1h', {key: 'selective', cacheFilter: (req, res, content) => res.statusCode == 200}), (req, res) => {
			res.status(req.params.code).send({
				code: new Number(req.params.code),
				random: random(0, 99999999),
			});
		});

		app.get('/cache/invalidate/:key', (req, res) =>
			cache.unset(req.params.key)
				.then(()=> res.sendStatus(200))
		);

		server = app.listen(port, null, function(err) {
			if (err) return finish(err);
			finish();
		});
	});

	after(finish => server.close(finish));
	// }}}

	it('act as a simple server', function() {
		this.timeout(5 * 1000);

		return axios.get(`${url}/cache/ok`)
			.then(({status}) => {
				expect(status).to.equal(200);
			});
	});

	it('simple cache test', function() {
		this.timeout(5 * 1000);

		return Promise.resolve()
			.then(()=> axios.get(`${url}/cache/100ms`))
			.then(({data}) => {
				expect(data).to.have.property('random')

				return axios.get(`${url}/cache/100ms`)
					.then(({data: newData}) => ({newData, oldData: data}))
			})
			.then(({oldData, newData}) => {
				expect(oldData.random).to.equal(newData.random);
			})
	});

	// Ping various endpoints with different cache expiry times {{{
	[
		// {label: '100ms', min: 100, invalidate: 120, max: 500, text: '100ms', url: `${url}/cache/100ms`}, // Precision <1s is a bit weird with things like MemcacheD so its skipped here
		{label: '1s', min: 1000, invalidate: 1200, max: 5000, text: '1 second', url: `${url}/cache/1s`},
		{label: '2 seconds', min: 2000, invalidate: 2200, max: 8000, text: '2 seconds', url: `${url}/cache/2s`},
		{label: '3000ms', min: 3000, invalidate: 3200, max: 10000, text: '3000ms', url: `${url}/cache/3000ms`},
	].forEach(time => {

		describe(`should cache something for ${time.text} (${time.label}, invalidated > ${time.invalidate/1000})`, function() {
			this.timeout(time.max);

			let responses = [];
			it(`should make the initial request < ${time.min} (uncached)`, ()=>
				axios.get(time.url)
					.then(res => responses.push(res))
			);

			it('have a valid response the first time', ()=> {
				expect(responses[0].data).to.have.property('random');
				expect(responses[0].headers).to.have.property('etag');
			});

			it(`should make the second request (within cache range)`, ()=>
				axios.get(time.url)
					.then(res => responses.push(res))
			);

			it('have a valid response the second time', ()=> {
				expect(responses[1].data).to.have.property('random');
				expect(responses[1].data.random).to.equal(responses[0].data.random);
				expect(responses[1].headers).to.have.property('etag');
				expect(responses[1].headers.etag).to.equal(responses[0].headers.etag);
			});

			it(`should wait the invalidation period (${time.invalidate}ms)`, done => {
				setTimeout(()=> done(), time.invalidate);
			});


			it('make the third request (after cache range)', ()=>
				axios.get(time.url)
					.then(res => responses.push(res))
			);

			it('have a valid response the third time', ()=> {
				expect(responses[2].data).to.have.property('random');
				expect(responses[2].data.random).to.not.equal(responses[0].data.random);
				expect(responses[2].headers).to.have.property('etag');
				// FIXME: Should etag be identical or different after invalidation - MC 2017-11-22
				// expect(responses[2].headers.etag).to.not.equal(responses[1].headers.etag);
			});

		});

	});
	// }}}

	it('support dynamic keys', ()=> {
		// Initial hit
		let responses = [];
		return Promise.resolve()
			.then(()=> axios.get(`${url}/cache/customKey/foo`))
			.then(({data}) => responses.push(data))
			.then(()=> axios.get(`${url}/cache/invalidate/foo`)) // Request clear
			.then(({data}) => responses.push(data))
			.then(()=> axios.get(`${url}/cache/customKey/foo`))
			.then(({data}) => responses.push(data))
			.then(()=> {
				expect(responses).to.have.length(3);
				expect(responses).to.have.nested.property('0.key', 'foo');
				expect(responses).to.have.nested.property('0.random');
				expect(responses).to.have.nested.property('2.key', 'foo');
				expect(responses).to.have.nested.property('2.random');

				expect(responses[2].random).to.not.equal(responses[1].random);
			});
	});

	it('cache only when the response is 200 (custom behaviour)', ()=> {
		// Initial hit
		let responses = [];
		return Promise.resolve()
			.then(()=> axios.get(`${url}/cache/selective/200`))
			.then(res => {
				expect(res.data).to.be.an('object');
				expect(res.data).to.have.property('code', 200);
				expect(res.data).to.have.property('random');
				responses.push(res.data);
			})
			.then(()=> axios.get(`${url}/cache/selective/200`))
			.then(res => {
				expect(res.data).to.be.an('object');
				expect(res.data).to.have.property('code', 200);
				expect(res.data).to.have.property('random', responses[0].random);
				responses.push(res.data);
			})
			.then(()=> axios.get(`${url}/cache/invalidate/selective`))
			.then(()=> axios.get(`${url}/cache/selective/202`))
			.then(res => {
				expect(res.data).to.be.an('object');
				expect(res.data).to.have.property('code', 200);
				expect(res.data).to.have.property('random');
				responses.push(res.data);
			})
	});

	it('cache + restore marshaled values', ()=> Promise.resolve()
		.then(()=> axios.get(`${url}/cache/marshal`))
		.then(({data}) => {
			expect(data).to.have.property('2024');
			expect(data).to.have.property('random');
			expect(data).to.have.property('boolTrue', true);
			expect(data).to.not.have.property('undef');
			expect(data['2024']).to.match(/^2024-01-01T/);

			return data.random;
		})
		.then(oldRandom => axios.get(`${url}/cache/marshal`)
			.then(({data}) => ({data, oldRandom}))
		) // Second hit should be the cache
		.then(({data, oldRandom}) => {
			expect(data).to.have.property('2024');
			expect(data).to.have.property('random', oldRandom);
			expect(data).to.have.property('boolTrue', true);
			expect(data['2024']).to.match(/^2024-01-01T/);
			expect(data).to.not.have.property('undef');
		})
	);

});
