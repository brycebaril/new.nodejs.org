#!/usr/bin/env node

'use strict';

const Metalsmith = require('metalsmith');
const autoprefixer = require('autoprefixer-stylus');
const collections = require('metalsmith-collections');
const feed = require('metalsmith-feed');
const layouts = require('metalsmith-layouts');
const markdown = require('metalsmith-markdown');
const prism = require('metalsmith-prism');
const stylus = require('metalsmith-stylus');
const permalinks = require('metalsmith-permalinks');
const path = require('path');
const fs = require('fs');
const ncp = require('ncp');

const filterStylusPartials = require('./scripts/plugins/filter-stylus-partials');
const mapHandlebarsPartials = require('./scripts/plugins/map-handlebars-partials');
const versions = require('./source/versions');

/** Build **/

// load template.json for given language, but use default language as fallback
// for properties which are not present in the given language
const DEFAULT_LANG = 'en';

function i18nJSON (lang) {
    var defaultJSON = require(`./locale/${DEFAULT_LANG}/site.json`);
    var templateJSON = require(`./locale/${lang}/site.json`);
    var finalJSON = JSON.parse(JSON.stringify(defaultJSON));
    var merge = function (targetJSON, customJSON) {
        Object.keys(customJSON).forEach(function (key) {
            let value = customJSON[key];
            if (typeof value === 'object') {
                merge(targetJSON[key], value);
            } else {
                targetJSON[key] = value;
            }
        });
    };
    merge(finalJSON, templateJSON);
    return finalJSON;
}

const source = {
    project: {
        versions,
        currentVersion: versions[0].version,
        banner: {
            visible: false,
            content: 'Important <a href="#">security release</a>, please update now!'
        }
    }
};

function buildlocale (locale) {
    console.time('[metalsmith] build/' + locale + ' finished');
    const siteJSON = path.join(__dirname, 'locale', locale, 'site.json');
    const metalsmith = Metalsmith(__dirname);
    metalsmith
    .metadata({
        site: require(siteJSON),
        project: source.project,
        i18n: i18nJSON(locale)
    })
    .source(path.join(__dirname, 'locale', locale))
    .use(collections({
        blog : {
            pattern: 'blog/**/*.md',
            sortBy: 'date',
            reverse: true,
            refer: false
        },
        blogAnnounce : {
            pattern: 'blog/announcements/*.md',
            sortBy: 'date',
            reverse: true,
            refer: false
        },
        blogReleases : {
            pattern: 'blog/release/*.md',
            sortBy: 'date',
            reverse: true,
            refer: false
        },
        blogVulnerability : {
            pattern: 'blog/vulnerability/*.md',
            sortBy: 'date',
            reverse: true,
            refer: false
        },
        lastWeekly: {
            pattern: 'blog/weekly-updates/*.md',
            sortBy: 'date',
            reverse: true,
            refer: false,
            limit: 1
        },
        tscMinutes: {
            pattern: 'foundation/tsc/minutes/*.md',
            sortBy: 'date',
            reverse: true,
            refer: false
        }
    }))
    .use(markdown({ langPrefix: 'language-' }))
    .use(prism())
    .use(filterStylusPartials())
    .use(stylus({
        compress: true,
        paths:[path.join(__dirname, 'layouts', 'css')],
        use: [autoprefixer()]
    }))
    .use(permalinks({
        relative: false
    }))
    .use(feed({
        collection: 'blog',
        destination: 'feed/blog.xml',
        title: 'Node.js Blog'
    }))
    .use(feed({
      collection: 'blogAnnounce',
      destination: 'feed/announce.xml',
      title: 'Node.js Announcements'
    }))
    .use(feed({
        collection: 'blogReleases',
        destination: 'feed/releases.xml',
        title: 'Node.js Blog: Releases'
    }))
    .use(feed({
        collection: 'blogVulnerability',
        destination: 'feed/vulnerability.xml',
        title: 'Node.js Blog: Vulnerability Reports'
    }))
    .use(feed({
        collection: 'tscMinutes',
        destination: 'feed/tsc-minutes.xml',
        title: 'Node.js Technical Steering Committee meetings'
    }))
    .use(layouts({
        engine: 'handlebars',
        pattern: '**/*.html',
        partials: mapHandlebarsPartials(metalsmith, 'layouts', 'partials'),
        helpers: {
            equals: require('./scripts/helpers/equals.js'),
            startswith: require('./scripts/helpers/startswith.js'),
            i18n: require('./scripts/helpers/i18n.js'),
            changeloglink: require('./scripts/helpers/changeloglink.js'),
            strftime: require('./scripts/helpers/strftime.js'),
            apidocslink: require('./scripts/helpers/apidocslink.js')
        }
    }))
    .destination(path.join(__dirname, 'build', locale));

    metalsmith.build(function (err) {
        if (err) { throw err; }
        console.timeEnd('[metalsmith] build/' + locale + ' finished');
    });
}


function copystatic () {
    console.time('[metalsmith] build/static finished');
    fs.mkdir(path.join(__dirname, 'build'), function () {
        fs.mkdir(path.join(__dirname, 'build', 'static'), function () {
            ncp(path.join(__dirname, 'static'), path.join(__dirname, 'build', 'static'), function (err) {
                if (err) { return console.error(err); }
                console.timeEnd('[metalsmith] build/static finished');
            });
        });
    });
}


function fullbuild () {
    copystatic();
    fs.readdir(path.join(__dirname, 'locale'), function (e, locales) {
        locales.forEach(function (locale) {
            buildlocale(locale);
        });
    });
}


function server () {
    /** Static file server **/
    const st = require('st');
    const http = require('http');
    const mount = st({
        path: path.join(__dirname, 'build'),
        cache: false,
        index: 'index.html'
    });
    http.createServer(
        function (req, res) { mount(req, res); }
    ).listen(8080,
        function () { console.log('http://localhost:8080/en/'); }
    );

    /** File Watches for Re-Builds **/
    const chokidar = require('chokidar');
    const opts = {
        persistent: true,
        ignoreInitial: true,
        followSymlinks: true,
        usePolling: true,
        alwaysStat: false,
        depth: undefined,
        interval: 100,
        ignorePermissionErrors: false,
        atomic: true
    };
    const locales = chokidar.watch(path.join(__dirname, 'locale'), opts);
    const layouts = chokidar.watch(path.join(__dirname, 'layouts'), opts);
    const staticf = chokidar.watch(path.join(__dirname, 'static'), opts);

    function getlocale (p) {
        const pre = path.join(__dirname, 'locale');
        return p.slice(pre.length + 1, p.indexOf('/', pre.length + 1));
    }
    locales.on('change', function (p) {
        buildlocale(getlocale(p));
    });
    locales.on('add', function (p) {
        buildlocale(getlocale(p));
        locales.add(p);
    });

    layouts.on('change', fullbuild);
    layouts.on('add', function (p) { layouts.add(p); fullbuild(); });

    staticf.on('change', copystatic);
    staticf.on('add', function (p) { staticf.add(p); copystatic(); });
}

fullbuild();

if (process.argv[2] === 'serve') {
    server();
}
