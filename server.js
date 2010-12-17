var express = require('express')
var app = express.createServer()
var db = require('chaos')('db')
var statStore = {}
var colStore = {}
var dbSetTimeout = null
var dbGetTimeout = []

db.get('stats', function(err, data){
  statStore = (err) ? {} : JSON.parse(data)
})

app.configure(function(){
  app.use(express.bodyDecoder())
  app.use(express.favicon())
  app.set('view engine', 'jade')
  app.use(express.logger({ format: '":method :url" :status' }))
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }))
  app.use(app.router)
  app.set('views', __dirname + '/views')
  app.use(express.staticProvider(__dirname + '/public'))
})


function checkCol(req, res, next) {
  if (/^([A-Za-z0-9]+)$|^$/.test(req.params.col)) next()
  else next(new Error(req.params.col+' is not a valid collection name.'))
}

function getDb(col, cb) {
  db.get(col, function(err, data){
    if (data) cb(JSON.parse(data))
  })
}

function getDbTimeout(col, callback) {
  if (dbGetTimeout[col]) callback(null)
  else {
    getDb(col, function(data){
      clearTimeout(dbGetTimeout[col])
      dbGetTimeout[col] = setTimeout(function(){
        dbGetTimeout[col] = null
        console.log('Flushing colStore for '+col)
        colStore[col] = null
      }, 60*1000)
      callback(true, data)
    })
  }
}

function getCol(req, res, next) {
  getDbTimeout(req.params.col, function(check, data){
    if (check) {
      if (!data) next(new Error('Collection '+req.params.col+' does not exist.'))
      else {
        req.data = data
        colStore[req.params.col] = data
        next()
      }
    } else {
      req.data = colStore[req.params.col]
      next()
    }
  })
}

function saveDb(cb) {
  db.set('stats', JSON.stringify(statStore), function(err){
    //console.log(statStore)
    if (err) console.log('Error setting stats')
    if (cb) cb()
  })
}

function saveDbTimeout() {
  if (dbSetTimeout) return
  dbSetTimeout = setTimeout(function() {
    saveDb(function() {
      dbSetTimeout = null
    })
  }, 10*1000)
}

function stats(col, rand) {
  if (!statStore[col]) statStore[col] = {}
  if (statStore[col][rand]) statStore[col][rand]++
  else statStore[col][rand] = 1
  saveDbTimeout()
}

app.get('/', function(req, res){
  res.render('home')
})

app.get('/list', function(req, res, next){
  db.get('collections', function(err, data){
    var cols = []
    if (err) next(new Error('No collections exist.'))
    else {
      data = JSON.parse(data)
      var count = data.length
      data.forEach(function(col, i){
        db.get(col, function(err, cdata){
          cdata = JSON.parse(cdata)
          cols.push({name: col, count: cdata.avatars.length})
          count--
          if (count <= 0) {
           res.render('cols', { locals: {cols: cols} })
          }
        })
      })
    }
  })
})

app.get('/:col', checkCol, getCol, function(req, res, next){
  res.render('col', {locals: {col: {name: req.params.col}}})
})

app.get('/:col/list', checkCol, getCol, function(req, res, next){
  var data = req.data
  var avatars = []
  if (data.avatars.length < 1) res.send('No avatars.')
  data.avatars.forEach(function(url, i){
    var stats = statStore[req.params.col] && statStore[req.params.col][i] || 0
    avatars.push({url: url, count: stats})
  }) 
  res.render('col_list', {
    locals: {avatars: avatars}
  })
})

app.post('/', function(req, res, next){
  if (/^([A-Za-z0-9]+)$|^$/.test(req.body.col)) {
    if (req.body.col == 'list') next(new Error('You cannot name your collection \'list\' because it is used elsewhere.'))
    var body = {"avatars": []}
    db.set(req.body.col, JSON.stringify(body), function(err){
      if (!err) {
        dbGetTimeout[req.body.col] = null
        res.redirect(req.body.col)
      } else res.send('This avatar collection exists.')
    })
    db.get('collections', function(err, data){
        if (err) var data = []
        else data = JSON.parse(data)
        data.push(req.body.col)
        db.set('collections', JSON.stringify(data), function(err){
          if (err) console.log('Error creating collections db store.')
        })
    })
  } else next(new Error('The collection name must be alphanumerical. '+req.body.col))
})

app.post('/:col', checkCol, getCol, function(req, res, next){
  var data = req.data
  var url = req.body.url.trim()
  if (/^http:\/\/([A-Za-z0-9\/.~_-]+)\.(jpg|jpeg|gif|png)$|^$/.test(url)) {
    if (data.avatars.indexOf(url) == -1) {
      data.avatars.push(url)
      db.set(req.params.col, JSON.stringify(data), function(err){
        if (err) next(new Error('Trouble adding avatar. '+err))
        dbGetTimeout[req.params.col] = null
        res.redirect(req.params.col)
      })
    } else next(new Error('Avatar URL already exists.'))
  } else next(new Error('Not a valid image url.'))
})

app.get('/:col/avatar.jpg', checkCol, getCol, function(req, res){
  var data = req.data
  var random = Math.floor(Math.random()*data.avatars.length)
  stats(req.params.col, random)
  res.redirect(data.avatars[random])
})

app.error(function(err, req, res){
  res.send(''+err)
})

app.listen(80)

