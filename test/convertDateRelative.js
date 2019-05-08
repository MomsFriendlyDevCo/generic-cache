var _ = require('lodash');
var Cache = require('..');
var expect = require('chai').expect;
var moment = require('moment');

describe('convertDateRelative()', function() {

	var cache;
	before(()=> {
		cache = new Cache({modules: 'memory'});
		cache.init();
	});

	it('should be able to convert relative times (100ms)', ()=> {
		var now = Date.now();
		var nowDate = new Date(now);
		var nowDateMin = moment().subtract(1, 's').toDate();
		var nowDateMax = moment().add(1, 's').toDate();

		expect(cache.convertDateRelative(100)).to.be.within(nowDateMin, nowDateMax);
		expect(cache.convertDateRelative(_.clone(nowDate))).to.deep.equal(nowDate);
		expect(cache.convertDateRelative(moment(nowDate).add(100, 'ms'))).to.be.within(nowDateMin, nowDateMax);
		expect(cache.convertDateRelative('100ms')).to.be.within(nowDateMin, nowDateMax);
	});

	it('should be able to convert relative times (3s)', ()=> {
		var now = Date.now() + 3000;
		var nowDate = new Date(now);
		var nowDateMin = moment().subtract(10, 's').toDate();
		var nowDateMax = moment().add(10, 's').toDate();

		expect(cache.convertDateRelative(3000)).to.be.within(nowDateMin, nowDateMax);
		expect(cache.convertDateRelative(_.clone(nowDate))).to.deep.equal(nowDate);
		expect(cache.convertDateRelative(moment(nowDate).add(3, 's'))).to.be.within(nowDateMin, nowDateMax);
		expect(cache.convertDateRelative('3s')).to.be.within(nowDateMin, nowDateMax);
	});

	it('should be able to convert relative times (6h)', ()=> {
		var now = Date.now() + 1000 * 60 * 6;
		var nowDate = new Date(now);
		var nowDateMin = moment().subtract(7, 'h').toDate();
		var nowDateMax = moment().add(7, 'h').toDate();

		expect(cache.convertDateRelative(1000 * 60 * 6)).to.be.within(nowDateMin, nowDateMax);
		expect(cache.convertDateRelative(_.clone(nowDate))).to.deep.equal(nowDate);
		expect(cache.convertDateRelative(moment(nowDate).add(6, 'h'))).to.be.within(nowDateMin, nowDateMax);
		expect(cache.convertDateRelative('6h')).to.be.within(nowDateMin, nowDateMax);
	});

});
