from flask import Flask, redirect, render_template, url_for, abort
from json import load
app = Flask(__name__, static_url_path='/static')

with open('data.json', 'r') as f:
	data = load(f)
	
@app.get('/')
def index():
	return render_template('index.html')
	
@app.get('/game')
def index():
	return render_template('index.html')

@app.errorhandler(404)
def not_found(error):
	return render_template('404.html'), 404