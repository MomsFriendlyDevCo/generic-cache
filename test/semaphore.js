import axios from 'axios';
import bodyParser from 'body-parser';
import Cache from '#cache';
import {expect} from 'chai';
import express from 'express';
import expressLogger from 'express-log-url';
import {random, times} from 'lodash-es';
import {setTimeout as wait} from 'node:timers/promises';

let server;

let port = 8182;
let url = 'http://localhost:' + port;

describe('Semaphore', ()=> {

	let app;
	let cache;

	before('setup cache', ()=> cache = new Cache());
	before('init cache', ()=> cache.init({
		modules: ['redis'],
	}))

	// Express Setup {{{
	before('server setup', function(finish) {
		this.timeout(10 * 1000);

		app = express();
		app.set('log.indent', '      ');
		app.use(expressLogger);
		app.use(bodyParser.json());

		app.get('/ok', (req, res) => res.sendStatus(200));

		app.get('/semaphore',
			cache.semaphore(),
			(req, res) => {
				setTimeout(()=> res.send({random: random(0, 99999999)}), 500);
			},
		);

		app.get('/semaphore/no-local',
			cache.semaphore({useLocal: false}),
			(req, res) => {
				setTimeout(()=> res.send({random: random(0, 99999999)}), 500);
			},
		);

		app.get('/semaphore/cache',
			(req, res, next) => {
				console.log('HIT /cache');
				next();
			},
			cache.semaphore({useLocal: false}),
			cache.middleware('1s'),
			(req, res) => {
				setTimeout(()=> res.send({random: random(0, 99999999)}), 100);
			},
		);

		server = app.listen(port, null, function(err) {
			if (err) return finish(err);
			finish();
		});
	});

	after(finish => server.close(finish));
	// }}}

	it('act as a simple server', ()=>
		axios.get(`${url}/ok`)
			.then(({status}) => expect(status).to.equal(200))
	);

	it('respond to a single hit', function() {
		this.timeout(5 * 1000);

		return axios.get(`${url}/semaphore`)
			.then(({status, data}) => {
				expect(status).to.equal(200);
				expect(data.random).to.be.a('number');
			});
	});

	it('handle local state for multiple hits', function() {
		this.timeout(10 * 1000);

		return Promise.all(
			times(10, ()=>
				axios.get(`${url}/semaphore`),
			),
		)
			.then(responses => {
				expect(responses).to.be.an('array');
				responses.forEach(({status, data}) => {
					expect(status).to.equal(200);
					expect(data.random).to.be.a('number');
					expect(data.random).to.equal(responses[0].data.random);
				});
			})
	});

	it('handle state for multiple hits (cache only, no local)', function() {
		this.timeout(10 * 1000);

		return Promise.all(
			times(10, ()=>
				axios.get(`${url}/semaphore/no-local`),
			),
		)
			.then(responses => {
				expect(responses).to.be.an('array');
				responses.forEach(({status, data}) => {
					expect(status).to.equal(200);
					expect(data.random).to.be.a('number');
					expect(data.random).to.equal(responses[0].data.random);
				});
			})
	});

	it('combine semaphore + cache', function() {
		this.timeout(60 * 1000);

		// Request factory
		let makeRequest = ()=> axios.get(`${url}/semaphore/cache`)
			.then(({data}) => {
				if (randomNumber === undefined) {
					randomNumber = data.random;
				} else {
					expect(data.random).to.equal(randomNumber);
				}
			})

		let randomNumber; // First random number we saw
		return Promise.resolve()
			.then(()=> Promise.all(
				times(3, makeRequest), // Fire 3 requests at the semaphore
			))
			.then(()=> wait(500)) // Wait a whole second for original worker to complete then...
			.then(()=> Promise.all(
				times(3, makeRequest), // Fire a subsequent 3 requests
			))
			.then(()=> wait(2000)) // Wait another second for cache to expire
			.then(()=> axios.get(`${url}/semaphore/cache`))
			.then(({data}) => expect(data.random).to.not.equal(randomNumber))
	});

});
