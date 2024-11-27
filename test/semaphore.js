import axios from 'axios';
import bodyParser from 'body-parser';
import Cache from '#cache';
import {expect} from 'chai';
import express from 'express';
import expressLogger from 'express-log-url';
import {random, times} from 'lodash-es';

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

		server = app.listen(port, null, function(err) {
			if (err) return finish(err);
			finish();
		});
	});

	after(finish => server.close(finish));
	// }}}

	it('should act as a simple server', ()=>
		axios.get(`${url}/ok`)
			.then(({status}) => expect(status).to.equal(200))
	);

	it('should respond to a single hit', function() {
		this.timeout(5 * 1000);

		return axios.get(`${url}/semaphore`)
			.then(({status, data}) => {
				expect(status).to.equal(200);
				expect(data.random).to.be.a('number');
			});
	});

	it('should handle local state for multiple hits', function() {
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

	it('should handle state for multiple hits (cache only, no local)', function() {
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

});
