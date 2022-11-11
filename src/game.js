'use strict';

const HEIGHT = 25;
const WIDTH = 60;


let DEBUG_ALL_EXPLORED = true;


//TODO: wrap this so it isn't global
//global display that entire application needs access to
const display = new ROT.Display({width: WIDTH, height: HEIGHT, fontFamily: 'Roboto Mono'});
const randInt = ROT.RNG.getUniformInt.bind(ROT.RNG);


document.getElementById('game').appendChild(display.getContainer());
display.draw(5, 4, '@');



/** Entities **/

const ENTITY_PROPERTIES = {
    player: {blocks: true,  renderOrder: 9, visuals: ['@', "hsl(60, 100%, 70%)"], },
    troll:  {blocks: true,  renderOrder: 6, visuals: ['T', "hsl(120, 60%, 30%)"], },
    orc:    {blocks: true,  renderOrder: 6, visuals: ['o', "hsl(100, 30%, 40%)"], },
    corpse: {blocks: false, renderOrder: 0, visuals: ['%', "darkred"], },
};


const entityPrototype = {
    get blocks() { return ENTITY_PROPERTIES[this.type].blocks; },
    get visuals() { return ENTITY_PROPERTIES[this.type].visuals; },
    get renderOrder() { return ENTITY_PROPERTIES[this.type].renderOrder; },
}


function blockingEntityAt(x, y){
    for(let entity of entities.values()){
        if(entity.blocks && entity.x === x && entity.y === y){
            return entity;
        }
    }

    return null;
}

function createMonsters(room, maxMonstersPerRoom){
    let numMonsters = randInt(0, maxMonstersPerRoom);

    for(let i = 0; i < numMonsters; i++){
        let x = randInt(room.getLeft(), room.getRight()),
            y = randInt(room.getTop(), room.getBottom());

        if(!blockingEntityAt(x, y)){
            let ai = {behavior: 'moveToPlayer'};
            let [type, props] = randInt(0, 3) === 0
                ? ['troll', {hp: 16, defense: 1, power: 4, ai}]
                : ['orc' ,  {hp: 10, defense: 0, power: 3, ai}];
            createEntity(type, x, y, props);
        }
    }
}

let entities = new Map();

function createEntity(type, x, y, properties={}){
    let id = ++createEntity.id;
    let entity = Object.create(entityPrototype);
    entity.name = type;
    Object.assign(entity, { id, type, x, y, ...properties });
    entities.set(id, entity);
    return entity;
}
createEntity.id = 0;


let player = createEntity('player', 1, 5, {hp: 30, defense: 2, power: 5});



/** Map Gen **/

function createMap(initializer) {
    function key(x, y) { return `${x},${y}`; }
    return {
        _values: new Map(),
        at(x, y) {
            let k = key(x, y);
            if (!this._values.has(k)) { this._values.set(k, initializer()); }
            return this._values.get(k);
        },
        has(x, y) { return this._values.has(key(x, y)); },
        get(x, y) { return this._values.get(key(x, y)); },
        set(x, y, value) { return this._values.set(key(x, y), value); },
    };
}

function createTileMap(width, height) {
    let tileMap = createMap();
    const digger = new ROT.Map.Digger(width, height);
    digger.create((x, y, contents) =>
        tileMap.set(x, y, {
            walkable: contents === 0,
            wall: contents === 1,
            explored: false,
        })
    );

    tileMap.rooms = digger.getRooms();
    tileMap.corridors = digger.getCorridors();

    return tileMap;
}

let tileMap = createTileMap(WIDTH, HEIGHT);
for(let room of tileMap.rooms){
    createMonsters(room, 3);
}


function computeLightMap(center, tileMap) {
    let lightMap = createMap(); // 0.0–1.0

    fov.compute(center.x, center.y, 10, (x, y, r, visibility) => {
        lightMap.set(x, y, visibility);
        if (visibility > 0.0) {
            if (tileMap.has(x, y))
                tileMap.get(x, y).explored = true;
        }
    });
    return lightMap;
}

function computeGlyphMap(entities) {
    let glyphMap = createMap(); // [char, fg, optional bg]

    entities = Array.from(entities.values());
    entities.sort((a, b) => a.renderOrder - b.renderOrder);
    entities.forEach(e => glyphMap.set(e.x, e.y, e.visuals));

    return glyphMap;
}


/** Movement **/

function playerMoveBy(dx, dy){
    let newX = player.x + dx,
        newY = player.y + dy;
    if (tileMap.get(newX, newY).walkable) {
        let target = blockingEntityAt(newX, newY);
        if(target){
            attack(player, target)
        }
        else {
            player.x = newX;
            player.y = newY;
        }

        enemiesMove();
    }
}

function enemiesMove(){
    let lightMap = computeLightMap(player, tileMap);

    for(let entity of entities.values()) {
        if(!entity.dead && entity.ai && entity.ai.behavior === 'moveToPlayer') {
            if(!(lightMap.get(entity.x, entity.y) > 0.0)){
                //Player cannot see the monster, and vice versa. The monster can't move towards the player
                continue;
            }

            if(entity.x === player.x && entity.y === player.y){
                throw "Invariant broken: monster and player are in the same location";
            }

            let dx = player.x - entity.x,
                dy = player.y - entity.y;

            //Pick horizontal/vertical movement randomly
            let stepx = 0, stepy = 0;

            if(randInt(1, Math.abs(dx) + Math.abs(dy)) <= Math.abs(dx)){
                stepx = dx / Math.abs(dx);
            }
            else {
                stepy = dy / Math.abs(dy);
            }


            let newX = entity.x + stepx, newY = entity.y + stepy;

            if(tileMap.get(newX, newY).walkable){
                let target = blockingEntityAt(newX, newY);
                if(target && target.id === player.id){
                    attack(entity, player);
                }
                else if(target){
                    //Another monster there, can't move there
                }
                else {
                    //take a step
                    entity.x = newX;
                    entity.y = newY;
                }
            }
        }
    }
}


/** Combat **/


function takeDamage(target, amount){
    target.hp -= amount;
    if(target.hp <= 0){
        print(`${target.type} dies!`);
        target.dead = true;
        target.type = 'corpse';
        target.name = `${target.name}'s corpse`;
        delete target.ai;
    }
}

function attack(attacker, defender){
    let damage = attacker.power - defender.defense;
    if(damage > 0) {
        print(`${attacker.type} attacks ${defender.type} for ${damage} hit points.`);
        takeDamage(defender, damage);
    }
    else{
        print(`${attacker.name} attacks ${defender.name} but does no damage.`);
    }
}



/** Input **/

function setupKeyboardHandler(display, handler){
    const canvas = display.getContainer();
    const instructions = document.getElementById('instructions');
    canvas.setAttribute('tabindex', "1");
    canvas.addEventListener('keydown', handleKeyDown)
    canvas.addEventListener('blur', () => { instructions.textContent = "Click game for keyboard focus"; });
    canvas.addEventListener('focus', () => { instructions.textContent = "Arrow keys to move"; });
    canvas.focus();
}

function handleKeys(key){
    const actions = {
        ["ArrowRight"]: () => ['move', +1, 0],
        ["ArrowLeft"]:  () => ['move', -1, 0],
        ["ArrowDown"]:  () => ['move', 0, +1],
        ["ArrowUp"]:    () => ['move', 0, -1],
        ["o"]:          () => ['toggle-debug'],
    };

    let action = actions[key];
    return action ? action() : undefined;
}

function handleKeyDown(event){
    let action = handleKeys(event.key);

    if(player.dead){
        print("You are dead");
        return;
    }

    if(action){
        event.preventDefault();
        switch(action[0]){
            case 'move': {
                let [_, dx, dy] = action;
                playerMoveBy(dx, dy);
                break;
            }
            case 'toggle-debug': {
                DEBUG_ALL_EXPLORED = !DEBUG_ALL_EXPLORED;
                break;
            }
            default:
                throw `unhandled action ${action}`
        }
        draw();
    }
}


/** Rendering **/

const fov = new ROT.FOV.PreciseShadowcasting((x, y) => tileMap.has(x, y) && tileMap.get(x, y).walkable);

const mapColors = {
    [false]: {[false]: "rgb(50, 50, 150)",  [true]: "rgb(0, 0, 100)"},
    [true]:  {[false]: "rgb(200, 180, 50)", [true]: "rgb(130, 110, 50)"},
};

function draw() {
    display.clear();

    let lightMap = computeLightMap(player, tileMap);
    let glyphMap = computeGlyphMap(entities);

    for(let y = 0; y < HEIGHT; y++){
        for(let x = 0; x < WIDTH; x++){
            let tile = tileMap.get(x, y);

            if(!tile || (!DEBUG_ALL_EXPLORED && !tile.explored)) { continue; }

            let lit = DEBUG_ALL_EXPLORED || lightMap.get(x, y) > 0.0;
            let ch = ' ', fg = "black", bg = mapColors[lit][tile.wall];
            let glyph = glyphMap.get(x, y);

            if(glyph){
                ch = lit ? glyph[0] : ch;
                fg = glyph[1];
                bg = glyph[2] || bg;
            }

            display.draw(x, y, ch, fg, bg);
        }
    }
}

function print(message){
    const MAX_LINES = 5;
    let messages  = document.querySelector("#messages");
    let lines = messages.textContent.split("\n");
    lines.push(message);

    while(lines.length > MAX_LINES) {
        lines.shift();
    }

    messages.textContent = lines.join("\n");
}

draw();
setupKeyboardHandler(display, handleKeyDown);
