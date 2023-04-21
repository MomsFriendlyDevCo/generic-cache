import _ from 'lodash';
import Cache from '../index.js';
import {expect} from 'chai';
import moment from 'moment';

describe('convertDateRelative()', function() {

	let cache;
	before(()=> {
		cache = new Cache({modules: 'memory'});
		cache.init();
	});

	it('should be able to convert relative times (100ms)', ()=> {
		let now = Date.now();
		let nowDate = new Date(now);
		let nowDateMin = moment().subtract(1, 's').toDate();
		let nowDateMax = moment().add(1, 's').toDate();

		expect(cache.convertDateRelative(100)).to.be.within(nowDateMin, nowDateMax);
		expect(cache.convertDateRelative(_.clone(nowDate))).to.deep.equal(nowDate);
		expect(cache.convertDateRelative(moment(nowDate).add(100, 'ms'))).to.be.within(nowDateMin, nowDateMax);
		expect(cache.convertDateRelative('100ms')).to.be.within(nowDateMin, nowDateMax);
	});

	it('should be able to convert relative times (3s)', ()=> {
		let now = Date.now() + 3000;
		let nowDate = new Date(now);
		let nowDateMin = moment().subtract(10, 's').toDate();
		let nowDateMax = moment().add(10, 's').toDate();

		expect(cache.convertDateRelative(3000)).to.be.within(nowDateMin, nowDateMax);
		expect(cache.convertDateRelative(_.clone(nowDate))).to.deep.equal(nowDate);
		expect(cache.convertDateRelative(moment(nowDate).add(3, 's'))).to.be.within(nowDateMin, nowDateMax);
		expect(cache.convertDateRelative('3s')).to.be.within(nowDateMin, nowDateMax);
	});

	it('should be able to convert relative times (6h)', ()=> {
		let now = Date.now() + 1000 * 60 * 6;
		let nowDate = new Date(now);
		let nowDateMin = moment().subtract(7, 'h').toDate();
		let nowDateMax = moment().add(7, 'h').toDate();

		expect(cache.convertDateRelative(1000 * 60 * 6)).to.be.within(nowDateMin, nowDateMax);
		expect(cache.convertDateRelative(_.clone(nowDate))).to.deep.equal(nowDate);
		expect(cache.convertDateRelative(moment(nowDate).add(6, 'h'))).to.be.within(nowDateMin, nowDateMax);
		expect(cache.convertDateRelative('6h')).to.be.within(nowDateMin, nowDateMax);
	});

});
