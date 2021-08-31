'use strict';

const path 	= require('path');
const tools = require('./tools');
const _ 	= require('lodash');

const SQLOperator 	= require('./operator');
const SQLHelper 	= require('./helper');
const SQLPredefined = require('./predefined');

class SQLBuilder {
	constructor(languageModule, options) {
		options = options || {};

		this._initLodash(this);

		this._reservedWords = require('./reserved-words');

		this._options = options || {};
		this._options.test = (options && options.test) || false;
		this._options.createDocs = (options && options.createDocs) || false;

		// will be set by the languageModule
		// using the method setLanguage
		this._currentLanguage = null;
		this._quoteChar = '';

		this._operators = {};
		this._modules = {};	// only used on test or createDocs
		this._keywords = {};
		this._helperChain = [];
		this._values = [];

		// setup generall language Support for:
		this._setupLanguageSupport(SQLBuilder.supportedLanguages);

		// First load the specific Helpers and Operators
		// for the given languageModule
		if (_.isFunction(languageModule)){
			languageModule(this);
		} else if (_.isString(languageModule)){
			let specificLanguageModule = SQLBuilder.loadLanguage(languageModule);
			specificLanguageModule(this);
		} else {
			throw new Error (`Unknown language Parameter detected. Please provide a Function or String.`);
		}

		// this._loadModules();
		this._loadModulesNew();
	}

	setLanguage(language) {
		if (this._supportedLanguages.indexOf(language) == -1) {
			throw new Error(`The language "${language}" is currently not supported.`);
		}
		this._currentLanguage = language
	}

	setQuoteChar(charLeft, charRight) {
		this._quoteCharLeft = charLeft;
		this._quoteCharRight = charRight || charLeft;
	}

	addReservedWord(word) {
		this._reservedWords[word.toUpperCase()] = true;
	}

	/****
	 * Reggister the supported languages and creates helpers
	 * like isOracle(), isPostgreSQL(), etc.
	 */
	_setupLanguageSupport(languages) {
		this._supportedLanguages = languages;

		// add helpers for each Language supported
		this.forEach(languages, (language) => {
			this['is' + language] = () => {
				return language === this._currentLanguage;
			}
		});
	}

	/****
	 * _initBuilder
	 *
	 * Initialize all values/variables for a new query
	 * So we have to reset the values, helperChain, etc.
	 *
	 */
	_initBuilder() {
		this._helperChain = [];
		this._values = [];
	}

	_initLodash(classInstance){
		// add reference to useful helpers
		const usefulHelpers = [
			// validators
			'isArray', 'isString', 'isNumber', 'isBoolean', 'isPlainObject', 'isFunction',
			// iterate helpers
			'forEach'
		];

		_.forEach(usefulHelpers, (helper)=>{
			classInstance[helper] = _[helper];
		});
	}

	/**
	 * isPrimitive
	 *
	 * Returns true if the value is a String, Number or Boolean
	 * otherwise false.
	 *
	 * @param value {Any}	Specifies the value to check for a primitive value
	 * @return {Boolean} True/False weather it's a primitive value or not.
	 */
	isPrimitive(value) {
		// for SQL > NULL will also be a leagal primitive value
		return (value === null || _.isDate(value) || _.isString(value) || _.isNumber(value) || _.isBoolean(value));
	}

	/**
	 * @summary Check for a valid identifier
	 * @memberof SQLBuilder
	 *
	 * @param identifier {String} specifies the identifier to check
	 * @return {Boolean} true or false whether we got a valid ident or not
	 */
	isValidIdent(identifier){
		return /^[a-z_][a-z0-9_$]*$/.test(identifier) === true && !this._reservedWords[identifier.toUpperCase()];
	}

	formatDate(date) {
		// convert to ISO 8601 format
	    date = date.replace('T', ' ');
	    date = date.replace('Z', '+00');
	    return date;
	}

	// source from https://github.com/datalanche/node-pg-format/blob/master/lib/index.js
	// with some modification to the needs of SQLBuilder2
	quoteLiteral(value) {
	    var literal = null;
	    var explicitCast = null;

		if (_.isNumber(value)) {
			return '' + value;
		} else if (value === undefined || value === null) {
	        return 'NULL';
	    } else if (value === false) {
	        return 'FALSE'; // "'f'";
	    } else if (value === true) {
	        return 'TRUE'; // "'t'";
	    } else if (value instanceof Date) {
	        return "'" + this.formatDate(value.toISOString()) + "'";
	    } else if (value instanceof Buffer) {
	        return "E'\\\\x" + value.toString('hex') + "'";
	    } else if (value === Object(value)) {
	        explicitCast = 'jsonb';
	        literal = JSON.stringify(value);
	    } else {
	        literal = value.toString().slice(0); // create copy
	    }

	    var hasBackslash = false;
	    var quoted = '\'';

	    for (var i = 0; i < literal.length; i++) {
	        var c = literal[i];
	        if (c === '\'') {
	            quoted += c + c;
	        } else if (c === '\\') {
	            quoted += c + c;
	            hasBackslash = true;
	        } else {
	            quoted += c;
	        }
	    }

	    quoted += '\'';

	    if (hasBackslash === true) {
	        quoted = 'E' + quoted;
	    }

	    if (explicitCast) {
	        quoted += '::' + explicitCast;
	    }

	    return quoted;
	};

	/**
	 * @summary Quotes the given identifier with the quote-character defined for the specific SQL language dialect.
	 * @memberof SQLBuilder
	 *
	 * @after
	 * # Quote Identifiers
	 *
	 * If you are creating your own helpers and operators you have to quote the generated identifiers.
	 * For this purpose you can use the standard method that will do the job for you.
	 *
	 * If you are passing only one identifier to the method you will receive the the identifier as quoted string.
	 * On passing two identifiers you will receive the quoted identifiers joined with a dot '.' like `table.column`.
	 *
	 * In exception to this a column-identifier with the value ` * ` or `ALL` will returned as unquoted string.
	 * Also all variable identifiers that starts with ` @ ` will be leave unquoted.
	 *
	 * @param  {String} identifier	Specifies the main identifier to quote. Normally it will be a column or an alias name.
	 *
	 * @return {String} Quoted identifier like `table`.`column`
	 */
	quote(identifier){
		if (!this.isString(identifier)) {
			throw new Error('Using quoted identifiers - arguments provided must always be type of String, but got "' + typeof identifier + '"')
		}

		if (identifier === '*' || identifier === 'ALL'){
			return identifier;
		}

		// check shortcut for INLINE-SQL
		if (identifier.startsWith('__:')) {
			return identifier.substring(3);
		}

		// do not quote identifiers starts with '@'
		// SELECT `first_name` INTO @firstname FROM `people`
		if (identifier.startsWith('@')){
			// a variable can't be quoted. it must always be a valid ident
			// else we have to stop here!
			if (!this.isValidIdent(identifier.substring(1))) {
				throw new Error(`Using quoted identifiers - Invalid identifier '${identifier}' detected`);
			}
			return identifier;
		}

		let splittedIdents = identifier.split('.');
		_.forEach(splittedIdents, (ident, index) => {
			// leave identifier * unquoted to get all columns from a table within a select
			// like SELECT label.* FROM label, label_desc
			if (ident === '*') return;

			// check if we have a valid (safe) identifier
			if (!this.isValidIdent(ident) || this._options.quoteIdentifiers) {
				// not really - it should quoted
				let quotedIdent = this._quoteCharLeft;
				for (let i = 0; i < ident.length; i++) {
					let c = ident[i];
					if (c === this._quoteCharRight) {
						quotedIdent += c + c;
					} else {
						quotedIdent += c;
					}
				}
				quotedIdent += this._quoteCharRight;
				splittedIdents[index] = quotedIdent;
			}
		});

		return splittedIdents.join('.');
	}

	/**
	 * @summary Specifies the placeholder function for the ANSI SQL Standard. This function can be overwrite by any SQL dialect loaded on instancing the builder.
	 * @memberof SQLBuilder
	 *
	 * @return {String} placeholder
	 */
	placeholder(){
		return '?';
	}

	/**
	 * @summary Adds the given value to the current value stack and returns the language specific placeholder as string.
	 * @memberof SQLBuilder
	 *
	 * @param {Primitive} val Specifies the value to add.
	 */
	addValue(val){
		// postgreSQL does not support parameterized values for create statements like CREATE TABLE
		if (this.isPostgreSQL() && (
				this.isCurrent('$createTable') ||
				this.isCurrent('$createIndex') ||
				this.isCurrent('$createView')
			)
		) {
			if (this.isString(val) && val.startsWith('~~')) {
				return this.quote(val.substring(2));
			}
			return this.quoteLiteral(val);

			/*if (this.isNumber(val)) {
				return val;
			} else if (this.isString(val)) {
				if (val.startsWith('~~')){
					return this.quote(val.substring(2));
				}
				return quoteLiteral(val);
			} else if (this.isBoolean(val)) {
				return val ? 'TRUE' : 'FALSE';
			} else {
				return val;
			}*/
		}

		// check a shotcut for INLINE-SQL
		if (this.isString(val) && val.startsWith('__:')) {
			return val.substring(3);
		}

		// check a shotcut for identifiers
		if (this.isString(val) && val.startsWith('~~')) {
			return this.quote(val.substring(2));
		}

		if (_.isDate(val)){
			this._values.push(val); //.toISOString());
		} else {
			if (_.isFunction(val)) {
				return val(null/*identifier*/);
			} else if (_.isPlainObject(val)) {
				return this._queryUnknown({$:val});
			} else {
				this._values.push(val);
			}
		}

		return this.placeholder();
	}

	/**
	 * @summary Returns all values of the current query added by the build method.
	 * On returning the values they will immediately removed from stack.
	 *
	 * @memberof SQLBuilder
	 *
	 * @return {Array}	Values as Array, where each item is a value regarding to the SQL-output-string
	 *
	 */
	currentValues(){
		let result = this._values;
		// Reset the values after output
		this._values = [];
		return this.transformValueResult(result);
	}

	/**
	 * @summary Returns all values of the current query added by the build method.
	 * This method could be overwritten by user to turn the array into an object.
	 *
	 * @memberof SQLBuilder
	 *
	 * @param valuesAsArray {Array}	Values to return to the user
	 * @return {Array}	Values as Array, where each item is a value regarding to the SQL-output-string
	 */
	transformValueResult(valuesAsArray){
		return valuesAsArray;
	}

	/**
	 * @summary Checks if the given Helper or Operator is on the current Path.
	 * If the helper is currently in use the function returns true, otherwise false.
	 *
	 * @memberof SQLBuilder
	 *
	 * @param  {String} name Specifies the name of the Helper or Operator
	 * @return {Boolean}
	 */
	isCurrent(name) {
		for (var i=this._helperChain.length-2/*ignore the current one*/; i >= 0; i--){
			if (this._helperChain[i] == name) {
				return true;
			}
		}
		return false;
	}

	/**
	 * @summary Returns true if the given Helper or Operator name is equal to
	 * the previous called Helper or Operator.
	 * Otherwise the function returns false.
	 *
	 * @param {String} 		name 	Specifies the name of the helper or operator like '$select'
	 *
	 * @return {Boolean} 			True or False weather the previouse helper equals to the give Name or not.
	 */
	isPreviousHelper(name){
		return (this._helperChain[this._helperChain.length - 2] == name);
	}

	isIdentifier(name) {
		if (_.isString(name)) {
			return ! (name.startsWith('$') || name == '__');
		}
		return false;
	}

	isOperator(name) {
		if (_.isString(name)) {
			return name.startsWith('$') || name == '__';
		}
		return false;
	}

	/**
	 * defineKeyword
	 *
	 * Creates the given keyword as unique Symbol on
	 * the current instance of the sqlBuilder.
	 *
	 * **Note** If the Keyword already exists, this will be overwritten.
	 *
	 * @param keyword {String}	Specifies the unique Keyword.
	 */
	defineKeyword(keyword, relativeModulePath, description) {
		let kw = keyword.toUpperCase();

		// remember the keyword and the definier for the docs
		if (!this._keywords[kw]) {
			this._keywords[kw] = [];
		}
		this._keywords[kw].push({
			relativeModulePath: relativeModulePath,
			description: description
		});

		this[kw] = Symbol('$SQL-' + keyword);

		if (this._options.attachGlobal === true && !global[kw]) {
			global[kw] = this[kw];
		}
	}

	_callHelper(operator, query, identifier){
		if (!this._operators[operator]){
			throw new Error(`An Operator or Helper named '${operator}' does not exists.`);
		}

		this._helperChain.push(operator);
		let result = this._operators[operator].__build__(query, identifier);
		this._helperChain.pop();
		return result;
	}

	_helperExists(helperName) {
		return this._operators[helperName] ? true:false;
	}

	/****
	 * Register all Modules located in the /sql directory.
	 *
	 * All Files located in a directory named "helpers" will
	 * registered as Helper. All files located in "operators" will
	 * resgistered as Operator. Directories which named "private" will be skipped.
	 *
	 */
	/*_loadModules(){
		let modules = tools.walk(path.join(__dirname, `../sql/`));

		_.forEach(modules, (module) => {
			if (module.endsWith('.js') && module.indexOf('private') == -1 && !path.basename(module).startsWith('.')) {
				this._register(module);
			}
		});
	}*/

	_loadModulesNew() {
		this._register(require('../sql/helpers/aggregation/aggregationHelper.js'), 'dummy\\sql\\helpers\\aggregation\\aggregationHelper.js');
		this._register(require('../sql/helpers/aggregation/avg/avg.js'), 'dummy\\sql\\helpers\\aggregation\\avg\\avg.js');
		this._register(require('../sql/helpers/aggregation/count/count.js'), 'dummy\\sql\\helpers\\aggregation\\count\\count.js');
		this._register(require('../sql/helpers/aggregation/max/max.js'), 'dummy\\sql\\helpers\\aggregation\\max\\max.js');
		this._register(require('../sql/helpers/aggregation/min/min.js'), 'dummy\\sql\\helpers\\aggregation\\min\\min.js');
		this._register(require('../sql/helpers/aggregation/sum/sum.js'), 'dummy\\sql\\helpers\\aggregation\\sum\\sum.js');
		this._register(require('../sql/helpers/arithmetic/add/add.js'), 'dummy\\sql\\helpers\\arithmetic\\add\\add.js');
		this._register(require('../sql/helpers/arithmetic/div/div.js'), 'dummy\\sql\\helpers\\arithmetic\\div\\div.js');
		this._register(require('../sql/helpers/arithmetic/mul/mul.js'), 'dummy\\sql\\helpers\\arithmetic\\mul\\mul.js');
		this._register(require('../sql/helpers/comparision/between/between.js'), 'dummy\\sql\\helpers\\comparision\\between\\between.js');
		this._register(require('../sql/helpers/comparision/contains/contains.js'), 'dummy\\sql\\helpers\\comparision\\contains\\contains.js');
		this._register(require('../sql/helpers/comparision/endsWith/endsWith.js'), 'dummy\\sql\\helpers\\comparision\\endsWith\\endsWith.js');
		this._register(require('../sql/helpers/comparision/eq/eq.js'), 'dummy\\sql\\helpers\\comparision\\eq\\eq.js');
		this._register(require('../sql/helpers/comparision/gt/gt.js'), 'dummy\\sql\\helpers\\comparision\\gt\\gt.js');
		this._register(require('../sql/helpers/comparision/gte/gte.js'), 'dummy\\sql\\helpers\\comparision\\gte\\gte.js');
		this._register(require('../sql/helpers/comparision/in/in.js'), 'dummy\\sql\\helpers\\comparision\\in\\in.js');
		this._register(require('../sql/helpers/comparision/like/like.js'), 'dummy\\sql\\helpers\\comparision\\like\\like.js');
		this._register(require('../sql/helpers/comparision/lt/lt.js'), 'dummy\\sql\\helpers\\comparision\\lt\\lt.js');
		this._register(require('../sql/helpers/comparision/lte/lte.js'), 'dummy\\sql\\helpers\\comparision\\lte\\lte.js');
		this._register(require('../sql/helpers/comparision/ne/ne.js'), 'dummy\\sql\\helpers\\comparision\\ne\\ne.js');
		this._register(require('../sql/helpers/comparision/nin/nin.js'), 'dummy\\sql\\helpers\\comparision\\nin\\nin.js');
		this._register(require('../sql/helpers/comparision/startsWith/startsWith.js'), 'dummy\\sql\\helpers\\comparision\\startsWith\\startsWith.js');
		this._register(require('../sql/helpers/ddl/column/column.js'), 'dummy\\sql\\helpers\\ddl\\column\\column.js');
		this._register(require('../sql/helpers/ddl/columns/columns.js'), 'dummy\\sql\\helpers\\ddl\\columns\\columns.js');
		this._register(require('../sql/helpers/ddl/constraint/check/check.js'), 'dummy\\sql\\helpers\\ddl\\constraint\\check\\check.js');
		this._register(require('../sql/helpers/ddl/constraint/constraint.js'), 'dummy\\sql\\helpers\\ddl\\constraint\\constraint.js');
		this._register(require('../sql/helpers/ddl/constraint/foreignKey/foreignKey.js'), 'dummy\\sql\\helpers\\ddl\\constraint\\foreignKey\\foreignKey.js');
		this._register(require('../sql/helpers/ddl/constraint/primary/primary.js'), 'dummy\\sql\\helpers\\ddl\\constraint\\primary\\primary.js');
		this._register(require('../sql/helpers/ddl/constraint/references/references.js'), 'dummy\\sql\\helpers\\ddl\\constraint\\references\\references.js');
		this._register(require('../sql/helpers/ddl/constraint/unique/unique.js'), 'dummy\\sql\\helpers\\ddl\\constraint\\unique\\unique.js');
		this._register(require('../sql/helpers/functions/cast/cast.js'), 'dummy\\sql\\helpers\\functions\\cast\\cast.js');
		this._register(require('../sql/helpers/functions/comparision/cmp/cmp.js'), 'dummy\\sql\\helpers\\functions\\comparision\\cmp\\cmp.js');
		this._register(require('../sql/helpers/functions/comparision/coalesce/coalesce.js'), 'dummy\\sql\\helpers\\functions\\comparision\\coalesce\\coalesce.js');
		this._register(require('../sql/helpers/functions/datetime/date/date.js'), 'dummy\\sql\\helpers\\functions\\datetime\\date\\date.js');
		this._register(require('../sql/helpers/functions/datetime/now/now.js'), 'dummy\\sql\\helpers\\functions\\datetime\\now\\now.js');
		this._register(require('../sql/helpers/functions/datetime/to_timestamp/to_timestamp.js'), 'dummy\\sql\\helpers\\functions\\datetime\\to_timestamp\\to_timestamp.js');
		this._register(require('../sql/helpers/functions/json/json.js'), 'dummy\\sql\\helpers\\functions\\json\\json.js');
		this._register(require('../sql/helpers/functions/json/PostgreSQL/jsonAgg/jsonAgg.js'), 'dummy\\sql\\helpers\\functions\\json\\PostgreSQL\\jsonAgg\\jsonAgg.js');
		this._register(require('../sql/helpers/functions/json/PostgreSQL/jsonbAgg/jsonbAgg.js'), 'dummy\\sql\\helpers\\functions\\json\\PostgreSQL\\jsonbAgg\\jsonbAgg.js');
		this._register(require('../sql/helpers/functions/json/PostgreSQL/jsonbBuildObject/jsonbBuildObject.js'), 'dummy\\sql\\helpers\\functions\\json\\PostgreSQL\\jsonbBuildObject\\jsonbBuildObject.js');
		this._register(require('../sql/helpers/functions/json/PostgreSQL/jsonbEach/jsonbEach.js'), 'dummy\\sql\\helpers\\functions\\json\\PostgreSQL\\jsonbEach\\jsonbEach.js');
		this._register(require('../sql/helpers/functions/json/PostgreSQL/jsonbObjectAgg/jsonbObjectAgg.js'), 'dummy\\sql\\helpers\\functions\\json\\PostgreSQL\\jsonbObjectAgg\\jsonbObjectAgg.js');
		this._register(require('../sql/helpers/functions/json/PostgreSQL/jsonbSet/jsonbSet.js'), 'dummy\\sql\\helpers\\functions\\json\\PostgreSQL\\jsonbSet\\jsonbSet.js');
		this._register(require('../sql/helpers/functions/json/PostgreSQL/jsonBuildObject/jsonBuildObject.js'), 'dummy\\sql\\helpers\\functions\\json\\PostgreSQL\\jsonBuildObject\\jsonBuildObject.js');
		this._register(require('../sql/helpers/functions/json/PostgreSQL/jsonEach/jsonEach.js'), 'dummy\\sql\\helpers\\functions\\json\\PostgreSQL\\jsonEach\\jsonEach.js');
		this._register(require('../sql/helpers/functions/json/PostgreSQL/jsonObjectAgg/jsonObjectAgg.js'), 'dummy\\sql\\helpers\\functions\\json\\PostgreSQL\\jsonObjectAgg\\jsonObjectAgg.js');
		this._register(require('../sql/helpers/functions/json/PostgreSQL/rowToJson/rowToJson.js'), 'dummy\\sql\\helpers\\functions\\json\\PostgreSQL\\rowToJson\\rowToJson.js');
		this._register(require('../sql/helpers/functions/misc/isnull/isnull.js'), 'dummy\\sql\\helpers\\functions\\misc\\isnull\\isnull.js');
		this._register(require('../sql/helpers/functions/string/concat/concat.js'), 'dummy\\sql\\helpers\\functions\\string\\concat\\concat.js');
		this._register(require('../sql/helpers/functions/string/left/left.js'), 'dummy\\sql\\helpers\\functions\\string\\left\\left.js');
		this._register(require('../sql/helpers/functions/systeminformations/current_database/current_database.js'), 'dummy\\sql\\helpers\\functions\\systeminformations\\current_database\\current_database.js');
		this._register(require('../sql/helpers/functions/systeminformations/current_schema/current_schema.js'), 'dummy\\sql\\helpers\\functions\\systeminformations\\current_schema\\current_schema.js');
		this._register(require('../sql/helpers/functions/systeminformations/current_user/current_user.js'), 'dummy\\sql\\helpers\\functions\\systeminformations\\current_user\\current_user.js');
		this._register(require('../sql/helpers/logical/and/and.js'), 'dummy\\sql\\helpers\\logical\\and\\and.js');
		this._register(require('../sql/helpers/logical/not/not.js'), 'dummy\\sql\\helpers\\logical\\not\\not.js');
		this._register(require('../sql/helpers/logical/or/or.js'), 'dummy\\sql\\helpers\\logical\\or\\or.js');
		this._register(require('../sql/helpers/misc/$/$.js'), 'dummy\\sql\\helpers\\misc\\$\\$.js');
		this._register(require('../sql/helpers/misc/anyExpr/anyExpr.js'), 'dummy\\sql\\helpers\\misc\\anyExpr\\anyExpr.js');
		this._register(require('../sql/helpers/misc/i/i.js'), 'dummy\\sql\\helpers\\misc\\i\\i.js');
		this._register(require('../sql/helpers/misc/__/__.js'), 'dummy\\sql\\helpers\\misc\\__\\__.js');
		this._register(require('../sql/helpers/queries/excluded/excluded.js'), 'dummy\\sql\\helpers\\queries\\excluded\\excluded.js');
		this._register(require('../sql/helpers/queries/from/from.js'), 'dummy\\sql\\helpers\\queries\\from\\from.js');
		this._register(require('../sql/helpers/queries/join/crossJoin/crossJoin.js'), 'dummy\\sql\\helpers\\queries\\join\\crossJoin\\crossJoin.js');
		this._register(require('../sql/helpers/queries/join/fullOuterJoin/fullOuterJoin.js'), 'dummy\\sql\\helpers\\queries\\join\\fullOuterJoin\\fullOuterJoin.js');
		this._register(require('../sql/helpers/queries/join/innerJoin/innerJoin.js'), 'dummy\\sql\\helpers\\queries\\join\\innerJoin\\innerJoin.js');
		this._register(require('../sql/helpers/queries/join/join.js'), 'dummy\\sql\\helpers\\queries\\join\\join.js');
		this._register(require('../sql/helpers/queries/join/leftJoin/leftJoin.js'), 'dummy\\sql\\helpers\\queries\\join\\leftJoin\\leftJoin.js');
		this._register(require('../sql/helpers/queries/join/rightJoin/rightJoin.js'), 'dummy\\sql\\helpers\\queries\\join\\rightJoin\\rightJoin.js');
		this._register(require('../sql/helpers/queries/limit/limit.js'), 'dummy\\sql\\helpers\\queries\\limit\\limit.js');
		this._register(require('../sql/helpers/queries/offset/offset.js'), 'dummy\\sql\\helpers\\queries\\offset\\offset.js');
		this._register(require('../sql/helpers/queries/orderBy/orderBy.js'), 'dummy\\sql\\helpers\\queries\\orderBy\\orderBy.js');
		this._register(require('../sql/helpers/queries/orFetch/orFetch.js'), 'dummy\\sql\\helpers\\queries\\orFetch\\orFetch.js');
		this._register(require('../sql/helpers/queries/orOffset/orOffset.js'), 'dummy\\sql\\helpers\\queries\\orOffset\\orOffset.js');
		this._register(require('../sql/helpers/queries/returning/returning.js'), 'dummy\\sql\\helpers\\queries\\returning\\returning.js');
		this._register(require('../sql/helpers/queries/ssFetch/ssFetch.js'), 'dummy\\sql\\helpers\\queries\\ssFetch\\ssFetch.js');
		this._register(require('../sql/helpers/queries/tableFunction/tableFunction.js'), 'dummy\\sql\\helpers\\queries\\tableFunction\\tableFunction.js');
		this._register(require('../sql/helpers/queries/top/top.js'), 'dummy\\sql\\helpers\\queries\\top\\top.js');
		this._register(require('../sql/helpers/queries/using/using.js'), 'dummy\\sql\\helpers\\queries\\using\\using.js');
		this._register(require('../sql/helpers/queries/where/where.js'), 'dummy\\sql\\helpers\\queries\\where\\where.js');
		this._register(require('../sql/operators/createIndex/createIndex.js'), 'dummy\\sql\\operators\\createIndex\\createIndex.js');
		this._register(require('../sql/operators/createTable/createTable.js'), 'dummy\\sql\\operators\\createTable\\createTable.js');
		this._register(require('../sql/operators/createView/createView.js'), 'dummy\\sql\\operators\\createView\\createView.js');
		this._register(require('../sql/operators/delete/delete.js'), 'dummy\\sql\\operators\\delete\\delete.js');
		this._register(require('../sql/operators/except/except.js'), 'dummy\\sql\\operators\\except\\except.js');
		this._register(require('../sql/operators/insert/insert.js'), 'dummy\\sql\\operators\\insert\\insert.js');
		this._register(require('../sql/operators/intersect/intersect.js'), 'dummy\\sql\\operators\\intersect\\intersect.js');
		this._register(require('../sql/operators/select/select.js'), 'dummy\\sql\\operators\\select\\select.js');
		this._register(require('../sql/operators/union/union.js'), 'dummy\\sql\\operators\\union\\union.js');
		this._register(require('../sql/operators/update/update.js'), 'dummy\\sql\\operators\\update\\update.js');
		this._register(require('../sql/operators/with/with.js'), 'dummy\\sql\\operators\\with\\with.js');

	}

	/**
	 * @summary Creates a new Operator or Helper
	 *
	 * @param file 	{String}	Specifies the path and filename of the operator or helper to register
	 */
	/*
		_register(sqlModule, file) {
		// let sqlModule = require(file);
	 */

	// _register(file) {
	_register(sqlModule, file) {
		// let sqlModule = require(file);
		if (!sqlModule.definition) {
			let modulePath = file.split(`${path.sep}sql`);
			let moduleDisplayPath = (modulePath && modulePath.length == 2 ? `${path.sep}sql` + modulePath[1] : file);
			throw new Error(`Can't register module '${moduleDisplayPath}'. There is no export for 'definition'.`);
		}

		let operatorClass = sqlModule.definition;
		let operatorClassName = operatorClass.name.startsWith('$') ? operatorClass.name.substring(1) : operatorClass.name;
		let operator = operatorClassName == '__' ? '__' : '$' + operatorClassName;

		// inject the current directory of the operator or helper
		// to use later on the SQLOperator calss to support the method
		// registerPrivateHelper, which need the local path of the
		// helper
		this.currentModulePath = path.join('../sql/', file.split(`${path.sep}sql`)[1]);
		// remove the filename
		this.currentModulePath = this.currentModulePath.split(path.sep);
		this.currentModulePath.pop();
		this.currentModulePath = this.currentModulePath.join(path.sep);

		let op = this._operators[operator] = new operatorClass(this);
		// inject the location (path) of this
		// module to use later on the docs, so thats possible
		// to link to private and public helpers and operators
		op.sqlPath = `.${path.sep}` + this.currentModulePath.split(`${path.sep}sql${path.sep}`)[1];

		// save the complete module-informations
		// if we are in test or documentation mode
		if (this._options.test || this._options.createDocs) {
			this._modules[operator] = module;
		}

		if (op.isOperator) {
			// add external Operator-Support like <builder>.$select(<query>);
			this[operator] = (query, identifier) => {
				return {
					sql: this._callHelper(operator, query, identifier),
					values: this.currentValues()
				}
			}

			// add all Operators in uppcerCase to
			// the global like SELECT, UPDATE, INSERT, ...
			if (this._options.attachGlobal === true && !global[operator.toUpperCase().replace('$', '')]) {
				global[operator.toUpperCase().replace('$', '')] = this[operator];
			}
		}

		// add functional support if exists on operator side
		if (_.isFunction(this._operators[operator].callee)) {
			this[operatorClassName] = (...args) => {
				return (identifier) => {
					let newArgs = _.cloneDeep(args);
					newArgs.push(identifier);
					return this._operators[operator].callee.apply(this, newArgs);
				}
			}

			// add all Callees in lowerCase to
			// the global like select, avg, count, isnull, ...
			if (this._options.attachGlobal === true && !global['$' + operatorClassName.toLowerCase()]) {
				global['$' + operatorClassName.toLowerCase()] = this[operatorClassName];
			}
		}
	}

	/**
	 * @summary Registers an Operator by his Name
	 *
	 * @param operatorName 	{String}	Specifies the Name of the Operator
	 */
	/*registerOperator(operatorName) {
		let operatorClass,
			moduleFilename = `../sql/operators/${operatorName}/${operatorName}.js`;

		try {
			operatorClass = require(moduleFilename);
		} catch (err) {
			throw new Error(`Unable to register Operator '${operatorName}'. Please make sure that it is located at '${path.join(__dirname, moduleFilename)}'`);
		}
		this._register(operatorClass);
	}*/

	/**
	 * @summary Registers an Operator by his Name
	 *
	 * @param operatorName 	{String}	Specifies the Name of the Operator
	 */
	/*registerHelper(relativePathAndName) {
		let helperClass,
			moduleFilename = `../sql/helpers/${relativePathAndName}.js`;

		try {
			helperClass = require(moduleFilename);
		} catch (err) {
			throw new Error(`Unable to register Helper '${relativePathAndName}'. Please make sure that it is located at '${path.join(__dirname, moduleFilename)}'`);
		}
		this._register(helperClass);
	}*/

	build(query) {
		if (!_.isPlainObject(query)) {
			throw new Error(`Query must always be an Object.`);
		}

		this._initBuilder();

		return {
			sql: this._queryUnknown(query, null, '; '),
			values: this.currentValues()
		}
	}

	_queryUnknown(query, identifier, joinedWith) {
		let results = [];

		if (_.isFunction(query)) {
			return query(identifier);
		}

		this.forEach(query, (value, key) => {
			if (!this._helperExists(key)) {
				throw new Error(`Error on building query. Unknown Operator '${key}' found.`);
			}
			results.push(this._callHelper(key, value, identifier));
		});
		return results.join(joinedWith || '');
	}
}

SQLBuilder.CALLEE = true;

SQLBuilder.supportedLanguages = [
	'PostgreSQL',
	'MySQL',
	'MariaDB',
	'Oracle',
	'SQLServer',
	'SQLite'
];

SQLBuilder.loadLanguage = function(language) {
	return require(__dirname + '/languages/' + language);
}

SQLBuilder.SQLOperator = SQLOperator;
SQLBuilder.SQLHelper = SQLHelper;
SQLBuilder.SQLPredefined = SQLPredefined;

module.exports = SQLBuilder;
