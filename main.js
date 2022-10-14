import * as THREE from "three";
import { VRButton } from 'https://unpkg.com/three@0.138.3/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'https://unpkg.com/three@0.138.3/examples/jsm/webxr/XRControllerModelFactory.js';

import { GLTFLoader } from 'https://unpkg.com/three@0.138.3/examples/jsm/loaders/GLTFLoader.js';

(function($) {
    
    class Game {
        
        static options;
        static renderer;
        static scene;
    
        static score = 0;
        static kills = 0;
        
        static config = {
            on_vr_headset: false,
            max_fps: 100,

            fov_far: 10000,
            assets_dir: 'assets',
    
            ajax_url: ".",

            remote_logging_enabled: false,
            
            sound: true,

        }
        
        static run(options) {
    
            try {

                if (typeof options === "object"){
                    for (const option_iden in options) {
                        Game.config[option_iden] = options[option_iden];
                    }
                }
    
                Game.log("starting game");
    
                Game.renderer = new THREE.WebGLRenderer({
                    antialias: true,
                    alpha: true,
                });
                Game.renderer.setSize(window.innerWidth, window.innerHeight);
                Game.renderer.xr.enabled = true;
                Game.renderer.xr.setReferenceSpaceType('local');
                Game.scene = new THREE.Scene();
    
                document.body.appendChild(Game.renderer.domElement);
                document.body.appendChild(VRButton.createButton(Game.renderer));
    
                Controls.init();
                Sounds.init();
                Level.init();
    
                Player.init();
                Alien.init();

                Blaster.init();
                Bullet.init();

                World.init();
    
                Game.renderer.setAnimationLoop(Game.render);
    
                Game.renderer.xr.addEventListener('sessionstart', Game.on_start_xr_session);
                Game.renderer.xr.addEventListener('sessionend', Game.on_end_xr_session);
    
            }
            catch (err) {
                Game.handle_error(err);
            }
    
        }

        static on_start_xr_session() {
            try {
                Game.log("xr session started");
            }
            catch (err) {
                Game.handle_error(err);
            }
        }
    
        static on_end_xr_session() {
            Game.log("xr session ended");
        }
        
        static render() {
            try {
                Game.tick();
                Game.renderer.render(Game.scene, Player.camera);
            }
            catch (err) {
                Game.handle_error(err);
            }
        }
    
        static clock = new THREE.Clock();
        
        static tick() {
            if ( typeof Game.tick.last_time === "undefined" ) {
                Game.tick.last_time = Game.clock.getElapsedTime();
                Game.tick.min_interval = 1/Game.config.max_fps;
                return;
            }
            
            let current_time = Game.clock.getElapsedTime();
            let interval_length = current_time - Game.tick.last_time;
            if (interval_length < Game.tick.min_interval) {
                return;
            }
            Game.tick.last_time = current_time;
            
    
            Level.tick(interval_length);
            Alien.move_all(interval_length);
            Bullet.move_all(interval_length);
    
            Controls.poll();
    
        }
    
        static log(msg) {
            console.log(msg);
            Game.log_remote(msg);
        }

        static handle_error(err) {
            err = "" + err.stack;
            if (Game.config.remote_logging_enabled) {
                Game._send_remote_log_msgs([err]);
            }
            throw (err);
        }
        
        static remote_log_queue = [];
        static log_remote(msg) {
    
            if (!Game.config.remote_logging_enabled) {
                return;
            }
            
            if (Game.remote_log_queue.length > 100) {
                console.log("remote log queue full, not sending");
                return;
            }
            Game.remote_log_queue.push(msg);
            Game.send_remote_log_queue(false);
    
        }
    
        static remote_log_in_process = false;
        static send_remote_log_queue(force_send) {
            if (!force_send && Game.remote_log_in_process) {
                return;
            }
            
            Game.remote_log_in_process = true;
    
            // console.log("sending remote log queue");
    
            let log_msgs = Game.remote_log_queue;
            Game.remote_log_queue = [];
            Game._send_remote_log_msgs(log_msgs, function() {
                setTimeout(
                    function() {
                        if (Game.remote_log_queue.length) {
                            Game.send_remote_log_queue(true);
                        }
                        else {
                            Game.remote_log_in_process = false;
                        }
                    },
                    1000
                );
            });
        }
        
        static _send_remote_log_msgs(log_msgs, callback){
            // console.log("sending remote message");
            let complete_cb = function() {
                if (callback) {
                    callback();
                }
            }

            $.ajax({
                type: 'POST',
                url: Game.config.ajax_url,
                data: {log: JSON.stringify({log_msgs: log_msgs})},
                complete: complete_cb,
                error: complete_cb
            });
        }
    
    }

    class Level {
    
        static current_level = 0;
    
        // paths:
//        1 = scrambler
//        2 = scrambler reversed
//        3 = loop on edges
//        4 = loop on edges reversed
//        5 = corkscrew
//        6 = corkscrew reversed
//        7 = corkscrew turned 90 degree
//        8 = corkscrew reversed
//        9 = bounce around perimeter
//        10 = bounce around perimeter reversed
//        11 = dive bomber
//        12 = dive bomber reversed


//        20 = boss 1 path
        
        
        static tick(interval_length) {
        
            Level.update_timer(interval_length);
    
            Level.update_level();

            Level.start_next_level();
            
        }
    
        static timer = 0;
        static is_timer_running = false;
        static duration = 60;

        static update_timer(interval_length) {
    
            if (typeof Level.update_timer.last_rounded_time === "undefined") {
                Level.update_timer.last_rounded_time = 0;
            }
    
            if (Level.is_timer_running) {
                Level.timer -= interval_length;
                if (Level.timer < 0) {
                    Level.timer = 0;
                }
        
                let rounded_time = Math.ceil(Level.timer);
                if (rounded_time < Level.update_timer.last_rounded_time) {
                    ScoreWatch.draw();
                }
                Level.update_timer.last_rounded_time = Math.ceil(Level.timer);
            }
            
        }
    
        static update_level() {
        
            if (Level.timer <= 0) {
                return;
            }

            if (Level.is_boss_level()) {
                if (Level.boss_destroyed) {
                    let nums_squadrons = Level.get_num_squadrons();
                    let num_aliens_per_squadron = Level.get_num_aliens_per_squadron();
                    let num_missing_alians = (nums_squadrons * num_aliens_per_squadron) - Alien.sprites.size;
                    let num_missing_squadrons = Math.floor(num_missing_alians / num_aliens_per_squadron);
                    if (num_missing_squadrons) {
                        Alien.spawn_squadrons(num_missing_squadrons, 250);
                    }
                }
            }
            else if (Alien.sprites.size < 5){
                Alien.spawn_squadrons(1);
            }
    
        }
    
    
        static start_next_level() {
        
            if (Level.timer > 0) {
                return;
            }
        
            if (Alien.sprites.size > 0) {
                // give leftover aliens from last level time to go away
                return;
            }
        
            if (!Game.renderer.xr.isPresenting) {
                return;
            }
        
            Level.current_level++;
            
            if (Level.current_level === 21) {
                Sounds.play("game_over");
                return;
            }
            if (Level.current_level > 21) {
                return;
            }
            
            Level.is_timer_running = false;
            Level.timer = Level.duration;
            
            setTimeout(
                function() {
                    if (Level.current_level <= 20) {
                        Sounds.play("level" + Level.current_level);
                    }
                    else if (Level.current_level === 21) {
                        Sounds.play("levels_complete");
                    }
                    else {
                        Sounds.play("next_level");
                    }
                    setTimeout(
                        function() {
                            Level.is_timer_running = true;
                        },
                        1000
                    );
                },
                1000
            );
        
            let level_start_delay = 3000;
            if (Level.is_boss_level()) {
                Alien.spawn_boss(level_start_delay)
            }
            else {
                Alien.spawn_squadrons(Level.get_num_squadrons(), level_start_delay);
            }
        }
    
        static get_num_squadrons() {
            let level_config = Level.levels.get(Level.current_level);
            return level_config.num_squadrons;
        }
    
        static get_level_speed() {
            let level_config = Level.levels.get(Level.current_level);
            return level_config.speed;
        }
    
        static get_max_alien_type() {
            let level_config = Level.levels.get(Level.current_level);
            return level_config.max_alien_type;
        }
    
        static get_num_aliens_per_squadron() {
            let level_config = Level.levels.get(Level.current_level);
            return level_config.num_aliens_per_squadron;
        }
    
        static boss_destroyed = false;
        static is_boss_level() {
            let level_config = Level.levels.get(Level.current_level);
            if (level_config.boss_type) {
                return true;
            }
            return false;
        }
    
        static get_max_missiles() {
            if (Level.current_level < 5) {
                return 0;
            }
            if (Level.current_level < 10) {
                return 1;
            }
            if (Level.current_level < 15) {
                return 2;
            }
            return 3;
        }
        
        static levels = new Map();
        static init() {
            
            let num_aliens = 0;
            for (let c = 0; c < Alien.aliens_config.length; c++) {
                if (Alien.aliens_config[c].is_minion) {
                    num_aliens++;
                }
            }
            
            for (let i = 1; i <= 20; i++) {
    
                let num_squadrons;
                if (i <= 5) {
                    num_squadrons = 3;
                }
                else if (i <= 10) {
                    num_squadrons = 4;
                }
                else if (i <= 15) {
                    num_squadrons = 5;
                }
                else {
                    num_squadrons = 6;
                }
    
                let num_aliens_per_squadron = 5;
                if (i > 5) {
                    num_aliens_per_squadron = 6;
                }
    
                let speed = 0.475 + (i * 0.0263157);
                if (speed > 1) {
                    speed = 1;
                }
    
                let max_alien_type = Math.floor( (i - 1) * 0.5 ) + 1;
                if (max_alien_type > num_aliens) {
                    max_alien_type = num_aliens;
                }
    
                let boss_type = null;
                let boss_path = null;
                if (i === 5 || i === 15) {
                    boss_type = 20;
                    boss_path = 20;
                }
                if (i === 10 || i === 20) {
                    boss_type = 21;
                    boss_path = 21;
                }
                
                // test a boss
                // if (i === 1) {
                //     boss_type = 21;
                //     boss_path = 21;
                // }
                
                Level.levels.set(i, {
                    level: i,
                    num_squadrons: num_squadrons,
                    speed: speed,
                    num_aliens_per_squadron: num_aliens_per_squadron,
                    max_alien_type: max_alien_type,
                    boss_type: boss_type,
                    boss_path: boss_path
                });
            }
        }
        
    }
    
    
    // https://opengameart.org/content/blaster-kit
    class Blaster extends THREE.Group {
        
        static blasters = new Map();

        static blaster_configs = [
            {
                iden: 'A',
                x: -0.075, y: -0.05, z: 0,
                bullet_color: "purple",
            },
            {
                iden: 'B',
                x: -0.075, y: -0.025, z: 0,
                bullet_color: "red",
            },
            {
                iden: 'C',
                x: -0.075, y: -0.005, z: 0,
                bullet_color: "red",
            },
            {
                iden: 'D',
                x: -0.075, y: -0.018, z: 0,
                bullet_color: "purple",
            },
            {
                iden: 'E',
                x: -0.075, y: -0.02, z: 0,
                bullet_color: "yellow",
            },
            {
                iden: 'F',
                x: -0.075, y: -0.035, z: 0,
                bullet_color: "purple",
            },
            {
                iden: 'G',
                x: -0.075, y: -0.035, z: 0,
                bullet_color: "yellow",
            },
            {
                iden: 'H',
                x: -0.075, y: -0.005, z: 0,
                bullet_color: "red",
            },
            {
                iden: 'I',
                x: -0.075, y: -0.018, z: 0,
                bullet_color: "purple",
            },
            {
                iden: 'J',
                x: -0.075, y: -0.036, z: 0,
                bullet_color: "yellow",
            },
            {
                iden: 'K',
                x: -0.075, y: -0.036, z: 0,
                bullet_color: "yellow",
            },
            {
                iden: 'L',
                x: -0.075, y: -0.026, z: 0,
                bullet_color: "purple",
            },
            {
                iden: 'M',
                x: -0.075, y: -0.05, z: 0,
                bullet_color: "yellow",
            },
            {
                iden: 'N',
                x: -0.075, y: -0.038, z: 0,
                bullet_color: "red",
            },
        ];
    
        static init() {
    
            let right_controller = Controls.get_xr_controller("right");
            let left_controller = Controls.get_xr_controller("left");
            if (!right_controller || !left_controller) {
                setTimeout(
                    function() {
                        Blaster.init()
                    },
                    100,
                );
                return;
            }

            for (let i = 0; i < Blaster.blaster_configs.length; i++) {
                let config = Blaster.blaster_configs[i];
                Blaster.create(right_controller, config);
                Blaster.create(left_controller, config);
            }
    
            Controls.add_event_listener(
                "onRightTriggerPressed",
                (function(handedness) {
                    return function(event) {
                        Blaster.fire(handedness);
                    }
                })("right"),
            );
            Controls.add_event_listener(
                "onLeftTriggerPressed",
                (function(handedness) {
                    return function(event) {
                        Blaster.fire(handedness);
                    }
                })("left"),
            );
            
            
        }
        
        static create(controller, config) {
    
            let blaster = new Blaster();
            const loader = new GLTFLoader();
            loader.load(
                'assets/blaster/blaster' +  config.iden + '.glb',
                (function(controller, config) {
                    return function(gltf) {
                        blaster.onloaded_cb(gltf, controller, config);
                    }
                })(controller, config),
                undefined,
                function (error) {
                    Game.log(error);
                }
            );
        }
        
        static frozen_until = 0;
        static freeze(seconds) {
            Blaster.frozen_until = Date.now() + (seconds * 1000);
        }
        
        onloaded_cb(gltf, controller, config) {
            this.name = controller.userData.handedness + " blaster " + config.iden;
            this.userData.blaster_config = config;

            let sprite = gltf.scene;
            let scale = 0.5;
            sprite.scale.set(scale, scale, scale);
            sprite.rotateY(Math.PI);
    
            sprite.position.set(config.x, config.y, config.z);
            
            sprite.traverse( child => {
                if ( child.material ) child.material.metalness = 0;
            } );

            this.add(sprite);

            Blaster.blasters.set(controller.userData.handedness + "-" + config.iden, this);

        }
    
        
        static equipped_right_blaster = null;
        static equipped_left_blaster = null;
        
        static fire(handedness) {
            
            if (Blaster.frozen_until && Blaster.frozen_until > Date.now()) {
                return;
            }
            
            if (
                handedness === "right"
                && Blaster.equipped_right_blaster !== null
            ) {
                new Bullet(Blaster.equipped_right_blaster);
                Sounds.play("blaster_shot");
            }
    
            if (
                handedness === "left"
                && Blaster.equipped_left_blaster !== null
            ) {
                new Bullet(Blaster.equipped_left_blaster);
                Sounds.play("blaster_shot");
            }
        }
        
        static equip_blaster(handedness, blaster_iden) {
    
            if (Blaster.frozen_until && Blaster.frozen_until > Date.now()) {
                return;
            }

            let controller = Controls.get_xr_controller(handedness);
            let blaster = Blaster.blasters.get(handedness + "-" + blaster_iden);
            if (!controller || !blaster) {
                setTimeout(
                    function() {
                        Blaster.equip_blaster(handedness, blaster_iden)
                    },
                    100,
                );
                return;
            }

            let play_sound = false;
            if (handedness === "right") {
                if (Blaster.equipped_right_blaster) {
                    controller.remove(Blaster.equipped_right_blaster);
                    play_sound = true;
                }
                Blaster.equipped_right_blaster = blaster;
            }
            else {
                if (Blaster.equipped_left_blaster) {
                    controller.remove(Blaster.equipped_left_blaster);
                    play_sound = true;
                }
                Blaster.equipped_left_blaster = blaster;
            }
    
            controller.add(blaster);
            if (play_sound) {
                Sounds.play("blaster_equipped", blaster);
            }
            
        }
    
    
    }
    
    class Bullet extends THREE.Group {
    
        static bullets;

        static geometry = null;
    
        static init() {
            Bullet.bullets = new THREE.Group();
            Game.scene.add(Bullet.bullets);
        }
        
        static move_all(interval_length) {
            Spark.move_all(interval_length);

            let bullets = [];
            for (let i = 0; i < Bullet.bullets.children.length; i++) {
                bullets.push(Bullet.bullets.children[i]);
            }
            for (let i = 0; i < bullets.length; i++) {
                bullets[i].move(interval_length);
            }
        }
        
        length;
        speed;
        range;
        distance_travelled = 0;
        sprite;
    
        static bullet_materials = {
            red: new THREE.MeshBasicMaterial({color: "#FF0000"}),
            green: new THREE.MeshBasicMaterial({color: "#00FF00"}),
            teal:new THREE.MeshBasicMaterial({color: "#00FFFF"}),
            yellow:new THREE.MeshBasicMaterial({color: "#ffff00"}),
            purple:new THREE.MeshBasicMaterial({color: "#9C70F5"}),
        };
        
        constructor(blaster) {
    
            super();
    
            this.speed = 30;
            this.range = 30;
            this.radius = 0.01;
            this.length = 2;
            
            if (Bullet.geometry === null) {
                Bullet.geometry = new THREE.BoxGeometry(this.radius, this.radius, this.length);
            }

            let material = Bullet.bullet_materials[blaster.userData.blaster_config.bullet_color];
            
            this.name = "bullet origin";
            
            this.sprite = new THREE.Mesh(Bullet.geometry, material);
            this.add(this.sprite);

            this.position.set(0, 0, 0 - (this.length / 2));
            blaster.add(this);
            Bullet.bullets.attach(this);

        }
    
        static raycaster = new THREE.Raycaster();
        static start_point = new THREE.Vector3();
        static end_point = new THREE.Vector3();
        static direction = new THREE.Vector3();

        move(interval_length) {

            let raycaster = Bullet.raycaster;
            let start_point = Bullet.start_point;
            let end_point = Bullet.end_point;
            let direction = Bullet.direction;
            
            let move_distance = this.speed * interval_length;
    
            start_point.set(
                this.sprite.position.x,
                this.sprite.position.y,
                this.sprite.position.z + (this.length / 2)
            );
    
            this.sprite.position.z -= move_distance;
    
            end_point.set(
                this.sprite.position.x,
                this.sprite.position.y,
                this.sprite.position.z - (this.length / 2)
            );
    
            this.updateWorldMatrix();
            this.localToWorld(start_point);
            this.localToWorld(end_point);

            direction.subVectors(end_point, start_point);
            direction.normalize();
            raycaster.set(start_point, direction);
            let targets = [];
            for (let t of Alien.sprites.values()) {
                if (
                    t.is_exploding
                    || t.is_teleporting_in
                    || t.is_teleporting_out
                    || !t.visible
                ) {
                    continue;
                }
                targets.push(t);
            }
            targets.push(World.platform_floor);
            targets.push(World.platform_ring);

            let intersects = raycaster.intersectObjects(targets, true);
            if (intersects.length) {
                let object_hit = intersects[0].object;
    
                if (object_hit.name === "platform") {
                    Spark.create_sparks(intersects[0].point, 0.1);
                    Sounds.play("metal_ping" + Utils.get_random_number(1,3), intersects[0].point);
                    this.remove();
                }
                
                else {
                    let part = object_hit;
                    let part_group = part.parent;
                    let alien = part_group.parent;
                    
                    if (
                        alien.has_kill_block
                        && !part.userData.is_kill_block
                    ) {
                        Spark.create_sparks(intersects[0].point, 0.3, "yellow", Player.group.position);
                        Sounds.play("enemy_hit", intersects[0].point);
                        object_hit.parent.remove(object_hit);
                        this.remove();
                        
                    }
                    else {
                        if (alien.name === "boss") {
                            Level.boss_destroyed = true;
                        }
                        alien.explode();
                        Game.kills += 1;
                        ScoreWatch.draw();
                        this.remove();
                    }
                }
            }
            
            this.distance_travelled += move_distance;
            
            if (this.distance_travelled >= this.range) {
                this.remove();
            }
        }
        
        remove() {
            Bullet.bullets.remove(this);
        }

    }
    
    class Spark extends THREE.Mesh {
    
        static sparks = new Map();

        static spark_materials = {
            yellow: new THREE.MeshBasicMaterial({color: "#FFFF00"}),
            white: new THREE.MeshBasicMaterial({color: "#FFFFFF"})
        };
        
        static spark_geometry = new THREE.BoxGeometry(0.01, 0.01, 0.01);

        static create_sparks(point, blast_size, color, point_towards_position) {
            if (!color) {
                color = "white";
            }
            let num_sparks = 50 * blast_size;
            for (let i = 0; i < num_sparks; i++) {
                let spark = new Spark(point, blast_size, color, point_towards_position);
                Spark.sparks.set(spark.uuid, spark);
            }
        }
    
        static move_all(interval_length) {
            for (let spark of Spark.sparks.values()) {
                spark.move(interval_length);
            }
        }
    
    
        constructor(point, blast_size, color, point_towards_position) {

            super(Spark.spark_geometry, Spark.spark_materials[color]);
            let scale = this.scale.x * (blast_size * 10);
            this.scale.set(scale, scale, scale);
            
            let spark_origin = new THREE.Group();
            spark_origin.name = "spark origin group";
            spark_origin.position.copy(point);
            Game.scene.add( spark_origin );
    
            spark_origin.add(this);
    
            if (!point_towards_position) {
                spark_origin.rotateX(0 - (Math.PI / 2));
            }
            else {
                spark_origin.lookAt(point_towards_position);
            }
    
            let ry = (Utils.get_random_number(0, Math.PI * 100) - (Math.PI * 50)) / 100;
            spark_origin.rotateY(ry);
            let rz = (Utils.get_random_number(0, Math.PI * 100) - (Math.PI * 50)) / 100;
            spark_origin.rotateX(rz);
    
            this.userData.distance_moved = 0;
            this.userData.blast_size = blast_size;
    
        }
        
        move(interval_length) {
    
            if (this.userData.distance_moved >= this.userData.blast_size) {
                Game.scene.remove(this.parent);
                Spark.sparks.delete(this.uuid);
                return;
            }

            let speed = 0.025;
            this.position.z += speed;
            this.userData.distance_moved += speed;
        }
        
    }
    
    
    class Alien extends THREE.Group {
    
        static sprites = new Map();
        
        static voxel_size = 0.08;
        static voxel_geometry = null;
    
        static voxel_materials = {
            red: new THREE.MeshBasicMaterial({color: "#FF0000"}),
            green: new THREE.MeshBasicMaterial({color: "#00FF00"}),
            blue: new THREE.MeshBasicMaterial({color: "#0000FF"}),
            teal:new THREE.MeshBasicMaterial({color: "#00FFFF"}),
            black:new THREE.MeshBasicMaterial({color: "#000000"}),
            yellow:new THREE.MeshBasicMaterial({color: "#ffff00"}),
            silver:new THREE.MeshBasicMaterial({color: "#AAAAAA"}),
            pink:new THREE.MeshBasicMaterial({color: "#FF17CD"}),
            magenta:new THREE.MeshBasicMaterial({color: "#FF00FF"}),
        };
        
        static move_all(interval_length) {
            for (let sprite of Alien.sprites.values()) {
                sprite.move(interval_length);
            }
            Alien.launch_missiles(interval_length);
        }
    
        outer_wheel;
        middle_wheel;
        inner_wheel;
        last_position;
        speed = 0.5;
        path;
        appear_time = 0;
        frames = [];
        current_frame = 0;
        time_per_frame = [];
        next_frame_time = 0;
        has_kill_block = false;
        do_teleport = false;
        
        constructor(options) {
            // type, speed, path, appear_time, do_teleport
            
            super();
    
            this.visible = false;
            this.name = "Sprite type " + options.type;
            
            if (options.speed) {
                this.speed = options.speed;
            }
            if (options.path) {
                this.path = options.path;
            }
            if (options.appear_time) {
                this.appear_time = options.appear_time;
            }
            if (options.do_teleport) {
                this.do_teleport = options.do_teleport;
            }
    
            
            if (Alien.voxel_geometry === null) {
                Alien.voxel_geometry = new THREE.BoxGeometry(Alien.voxel_size, Alien.voxel_size, Alien.voxel_size);
            }
    
            let alien_config = Alien.aliens.get(options.type);
            this.has_kill_block = alien_config.has_kill_block;

            this.frames = [];
            for (let f = 0; f < alien_config.parts.length; f++) {
                let parts = alien_config.parts[f];
                let part_group = new THREE.Group();
                for (let i = 0; i < parts.length; i++) {
                    let x = parts[i][0];
                    let y = parts[i][1];
                    let z = parts[i][2];
                    let color = parts[i][3];
                    let part = new THREE.Mesh(Alien.voxel_geometry, Alien.voxel_materials[color]);
                    part.position.set(x, y, z);
                    part.userData.is_kill_block = (this.has_kill_block && parts[i][4]);
                    part_group.add(part);
                }
                if (f < 2) {
                    // add main sprite and first animation frame
                    this.add(part_group);
                }
                if (f > 0) {
                    this.frames.push(part_group);
                }
            }
            
            if (alien_config.parts.length > 1) {
                this.time_per_frame = alien_config.time_per_frame;
                this.next_frame_time = Date.now() + this.time_per_frame[0];
            }
            
            this.inner_wheel = new THREE.Group();
            this.inner_wheel.name = "Sprite inner_wheel";
    
            this.middle_wheel = new THREE.Group();
            this.middle_wheel.name = "Sprite middle_wheel";
    
            this.outer_wheel = new THREE.Group();
            this.outer_wheel.name = "Sprite outer_wheel";
    
            if (this.path === 1) {
                this.inner_wheel.position.set(0,0,-7.5);
                this.position.set(0,0,6);
                
                this.outer_wheel.rotateZ(Math.PI  * 0.5);
                this.inner_wheel.rotateY(0 - 1.1);
                this.outer_wheel.rotateY(0 - 0.7);
            }
            else if (this.path === 2) {
                this.inner_wheel.position.set(0,0,-7.5);
                this.position.set(0,0,6);
                this.outer_wheel.rotateY(Math.PI / 2);
    
                this.outer_wheel.rotateZ(0 - (Math.PI * 0.5));
                this.inner_wheel.rotateY(1.1);
                this.outer_wheel.rotateY(0.7);
            }
            else if (this.path === 3) {
                this.inner_wheel.position.set(0,0,-6);
                this.position.set(0, 0, 6);
                this.inner_wheel.rotateX(Math.PI / 2);
                this.inner_wheel.rotateZ(Math.PI / 8);
    
                this.inner_wheel.rotateY(0 - 1.5);
                this.outer_wheel.rotateY(1);
                
            }
            else if (this.path === 4) {
                this.inner_wheel.position.set(0,0,-6);
                this.position.set(0, 0, 6);
                this.inner_wheel.rotateX(Math.PI / 2);
                this.inner_wheel.rotateZ(0 - (Math.PI / 8));
            }
            else if (this.path === 5) {
                this.inner_wheel.position.set(0,0,-7.5);
                this.position.set(0, 0, 6);
                this.inner_wheel.rotateZ(Math.PI / 2);
                this.outer_wheel.rotateZ(Math.PI / 2);
    
                this.inner_wheel.rotateY(2.2);
                this.outer_wheel.rotateY(0.25);
                
            }
            else if (this.path === 6) {
                this.inner_wheel.position.set(0,0,-7.5);
                this.position.set(0, 0, 6);
                this.inner_wheel.rotateZ(Math.PI / 2);
                this.outer_wheel.rotateZ(Math.PI / 2);
    
                this.inner_wheel.rotateY(2.2);
                this.outer_wheel.rotateY(0.25);

            }
            else if (this.path === 7) {
                this.inner_wheel.position.set(0,0,-7.5);
                this.position.set(0, 0, 6);
                this.inner_wheel.rotateZ(Math.PI / 2);
    
                this.inner_wheel.rotateY(2.2);
                this.outer_wheel.rotateY(0.25);
            }
            else if (this.path === 8) {
                this.inner_wheel.position.set(0,0,-7.5);
                this.position.set(0, 0, 6);
                this.inner_wheel.rotateZ(0 - (Math.PI / 2));
    
                this.inner_wheel.rotateY(0 - 2.2);
                this.outer_wheel.rotateY(0 - 0.25);
            }
            else if (this.path === 9) {
                this.position.set(0, 0, -7);
            }
            else if (this.path === 10) {
                this.position.set(0, 0, -7);
                this.outer_wheel.rotateY(Math.PI);
            }
            else if (this.path === 11) {
                this.position.set(0, 0, -2.5);
    
                this.inner_wheel.rotateY(1);
                this.outer_wheel.rotateY(2);
                this.position.y = (Math.sin(1)) * 15;
                this.position.x = (Math.sin(1)) * 1.5;

            }
            else if (this.path === 12) {
                this.position.set(0, 0, -2.5);
                this.outer_wheel.rotateX(Math.PI / 2);
            }


            // boss 1
            else if (this.path === 20) {
                this.middle_wheel.position.set(0, 2, -10);
                this.middle_wheel.rotateX(Math.PI / 4);
    
                this.inner_wheel.position.set(0, 0, -1);
                this.inner_wheel.rotateX(Math.PI / 4);
    
                this.userData.is_flipping = false;
                this.userData.next_flip = Date.now() + 4000;
    
            }
            // boss 2
            else if (this.path === 21) {
                this.middle_wheel.position.set(0, 2, -10);
                this.middle_wheel.rotateX(Math.PI / 4);
    
                this.inner_wheel.position.set(0, 0, -1);
                this.inner_wheel.rotateX(Math.PI / 4);
    
                this.userData.is_flipping = false;
                this.userData.next_flip = Date.now() + 4000;
    
            }

            // missile
            else if (this.path === 50) {
                this.position.copy(options.path_options.start_position);
                this.outer_wheel.lookAt(this.position);
                Game.scene.add(this.outer_wheel);

                let distance = this.outer_wheel.position.distanceTo(this.position);
                this.inner_wheel.position.z += distance / 2;
                this.inner_wheel.position.x += distance / (Utils.get_random_number(2,8));
                this.outer_wheel.add(this.inner_wheel);

                this.inner_wheel.attach(this);
    
                this.inner_wheel.remove(this);
                this.outer_wheel.remove(this.inner_wheel);
                Game.scene.remove(this.outer_wheel);
    
                this.userData.direction = Utils.get_random_number(0,1)
                if (this.userData.direction === 0) {
                    this.userData.direction = -1;
                }
            }

            // explosing, straight path
            else if (this.path === 90) {
            }
            
            // testing path
            else if (this.path === 99) {
                this.inner_wheel.position.set(0,0,-4);
                this.position.set(0, -2, -1);
                // this.rotateY(Math.PI / 4);
                // Game.log(this);
            }
            
            this.inner_wheel.add(this);
            this.middle_wheel.add(this.inner_wheel);
            this.outer_wheel.add(this.middle_wheel);
            Game.scene.add(this.outer_wheel);
            
            Game.scene.attach(this);
            Game.scene.remove(this);
            
            Alien.sprites.set(this.uuid, this);
    
        }
    
        move(interval_length) {
    
            if (this.appear_time !== null) {
                if (Date.now() >= this.appear_time) {
                    if (this.do_teleport) {
                        this.teleport_in();
                    }
                    else {
                        this.appear();
                    }
                }
                else {
                    return;
                }
            }
    
            let distance = interval_length * this.speed;
    
            if (!this.last_position) {
                this.last_position = new THREE.Vector3();
                this.last_position.copy(this.position);
            }
            this.userData.last_velocity = this.position.distanceTo(this.last_position);
            this.last_position.copy(this.position);
            
            // move
            this.inner_wheel.attach(this);

            if (this.path === 1) {
                this.outer_wheel.rotateZ(Math.PI * distance * 0.5);
                this.inner_wheel.rotateY(0 - (distance * 1.1));
                this.outer_wheel.rotateY(0 - (distance * 0.7));
                this.lookAt(this.last_position);
            }
            else if (this.path === 2) {
                this.outer_wheel.rotateZ(0 - (Math.PI * distance * 0.5));
                this.inner_wheel.rotateY(distance * 1.1);
                this.outer_wheel.rotateY(distance * 0.7);
                this.lookAt(this.last_position);
            }
            else if (this.path === 3) {
                this.inner_wheel.rotateY((0 - distance) * 1.5);
                this.outer_wheel.rotateY(distance);
                this.lookAt(this.last_position);
            }
            else if (this.path === 4) {
                this.inner_wheel.rotateY(distance * 1.5);
                this.outer_wheel.rotateY(0 - distance);
                this.lookAt(this.last_position);
            }
            else if (this.path === 5) {
                this.inner_wheel.rotateY(distance * 2.2);
                this.outer_wheel.rotateY(0 - (distance / 4));
                this.lookAt(this.last_position);
            }
            else if (this.path === 6) {
                this.inner_wheel.rotateY(distance * 2.2);
                this.outer_wheel.rotateY(distance / 4);
                this.lookAt(this.last_position);
            }
            else if (this.path === 7) {
                this.inner_wheel.rotateY(distance * 2.2);
                this.outer_wheel.rotateY(distance / 4);
                this.lookAt(this.last_position);
            }
            else if (this.path === 8) {
                this.inner_wheel.rotateY(0 - (distance * 2.2));
                this.outer_wheel.rotateY(0 - (distance / 4));
                this.lookAt(this.last_position);
            }
            else if (this.path === 9) {
                this.inner_wheel.rotateY(0 - (distance));
                this.position.y = (Math.sin(this.inner_wheel.rotation.y * 2)) * 5;
                this.lookAt(this.last_position);
            }
            else if (this.path === 10) {
                this.inner_wheel.rotateY(distance);
                this.position.y = (Math.sin(this.inner_wheel.rotation.y * 2)) * 5;
                this.lookAt(this.last_position);
            }
            else if (this.path === 11) {
                this.inner_wheel.rotateY(distance);
                this.outer_wheel.rotateY(distance * 2);
                this.position.y = (Math.sin(this.inner_wheel.rotation.y)) * 15;
                this.position.x = (Math.sin(this.inner_wheel.rotation.y)) * 1.5;
                this.lookAt(this.last_position);
            }
            else if (this.path === 12) {
                this.inner_wheel.rotateY(distance);
                this.outer_wheel.rotateY(distance * 2);
                this.position.y = (Math.sin(this.inner_wheel.rotation.y)) * 15;
                this.lookAt(this.last_position);
            }

            // boss 1
            else if (this.path === 20) {
    
                this.outer_wheel.rotateY(distance / 2);
                if (!this.userData.is_flipping) {
                    if (Date.now() > this.userData.next_flip) {
                        this.userData.is_flipping = true;
                        this.userData.flip_amount = 0;
                    }
                    this.inner_wheel.rotateY(0 - (distance * 1.5));
                    this.middle_wheel.rotateY(distance * 2);
        
                    this.lookAt(this.last_position);
                }
    
                if (this.userData.is_flipping) {
                    let flip_amount = distance * 12;
                    if (this.userData.flip_amount + flip_amount > (Math.PI * 2)) {
                        flip_amount = (Math.PI * 2) - this.userData.flip_amount;
                        this.userData.is_flipping = false;
                        this.userData.next_flip = Date.now() + Utils.get_random_number(8000, 15000);
                        // this.launch_missile();
                    }
                    this.userData.flip_amount += flip_amount;
                    this.rotateZ(flip_amount);
                }
    
            }

            // boss 2
            else if (this.path === 21) {
    
                this.outer_wheel.rotateY(distance / 2);
                if (!this.userData.is_flipping) {
                    if (Date.now() > this.userData.next_flip) {
                        this.userData.is_flipping = true;
                        this.userData.flip_amount = 0;
                    }
                    this.inner_wheel.rotateY(0 - (distance * 1.5));
                    this.middle_wheel.rotateY(distance * 2);
        
                    this.lookAt(Player.group.position);
                }
    
                if (this.userData.is_flipping) {
                    let flip_amount = distance * 12;
                    if (this.userData.flip_amount + flip_amount > (Math.PI * 2)) {
                        flip_amount = (Math.PI * 2) - this.userData.flip_amount;
                        this.userData.is_flipping = false;
                        this.userData.next_flip = Date.now() + Utils.get_random_number(8000, 15000);
                        // this.launch_missile();
                    }
                    this.userData.flip_amount += flip_amount;
                    this.rotateZ(flip_amount);
                }
    
            }
            
            // missile, towards player
            else if (this.path === 50) {
                this.inner_wheel.rotateY(distance * this.userData.direction);
                this.lookAt(this.last_position);
                if (this.last_position.distanceTo(Player.group.position) < 0.5) {
                    this.explode();
                    Blaster.freeze(3);
                }
            }


            // exploding, straight ahead path
            else if (this.path === 90) {
                this.position.z -= this.userData.last_velocity;
            }
            
            // test path
            else if (this.path === 99) {
                // this.position.z -= this.userData.last_velocity;

                // this.inner_wheel.rotateY(distance * 2);
                // this.lookAt(this.last_position);
    
                // this.rotateX(distance);
                // this.rotateY(distance );
                // this.rotateZ(distance * 4);

            }
            else {
                return;
            }
    
            // put the sprite back onto it's parent
            Game.scene.attach(this);
            
            if (this.is_exploding) {
                this.animate_explosion(interval_length);
            }
    
            else if (this.is_teleporting_in) {
                this.animate_teleporting_in(interval_length);
            }
            
            else if (this.is_teleporting_out) {
                this.animate_teleporting_out(interval_length);
            }
            
            else {
                this.animate(interval_length);
            }
            
    
            // timer is up, level ends
            if (
                !Level.timer
                && !this.is_exploding
                && !this.is_teleporting_in
                && !this.is_teleporting_out
            ) {
                if (Utils.get_random_number(0,50) === 50) {
                    if (this.do_teleport) {
                        this.teleport_out();
                    }
                    else {
                        this.explode();
                    }
                }
            }
    
            
        }
    
        
        animate(interval) {
            if (this.frames.length) {
                if (Date.now() >= this.next_frame_time) {
                    this.remove(this.frames[this.current_frame]);
                    this.current_frame++;
                    if (this.current_frame >= this.frames.length) {
                        this.current_frame = 0;
                    }
                    this.add(this.frames[this.current_frame]);
                    this.next_frame_time = Date.now() + this.time_per_frame[this.current_frame];
                }
            }
    
        }
        
        
        is_teleporting_in = false;
        is_teleporting_out = false;
        is_exploding = false;
        explosion_decay = 3;
    
        explode() {
            this.is_exploding = true;
            this.path = 90;
            Sounds.play("explosion", this.position);
    
            for (let i = 0; i < this.children.length; i++) {
                let parts_group = this.children[i];
                for (let i2 = 0; i2 < parts_group.children.length; i2++) {
                    let piece = parts_group.children[i2];
            
                    piece.explode_time = Date.now();
            
                    piece.userData.x = Utils.get_random_number(-100, 100) / 100;
                    piece.userData.y = Utils.get_random_number(-100, 100) / 100;
                    piece.userData.z = Utils.get_random_number(-100, 100) / 100;
            
                    let r_max = (Math.PI * 100) / 2;
                    piece.userData.rx = Utils.get_random_number(0 - r_max, r_max) / 100;
                    piece.userData.ry = Utils.get_random_number(0 - r_max, r_max) / 100;
                    piece.userData.rz = Utils.get_random_number(0 - r_max, r_max) / 100;
            
                    piece.burn_time = Utils.get_random_number(1, 200) / 100;
                }
            }
    
            Game.scene.attach(this);
            // this.outer_wheel.position.set(0,0,0);
            // this.middle_wheel.position.set(0,0,0);

            Game.scene.attach(this.inner_wheel);
            this.inner_wheel.position.copy(this.position);
            this.inner_wheel.lookAt(this.last_position);
            this.middle_wheel.attach(this.inner_wheel);
            
            // this.inner_wheel.attach(this);

            // this.userData.explosion_group.position.copy(this.position);
            // this.userData.explosion_group.lookAt(this.last_position);
            // Game.scene.add(this.userData.explosion_group);
            // this.userData.explosion_group.attach(this);
        }
    
        animate_explosion(interval_length) {
            let speed_factor = interval_length * this.explosion_decay;
            let spin_factor = interval_length;
            let scale_factor = this.explosion_decay;
            if (scale_factor > 1) {
                scale_factor = 1;
            }
            this.explosion_decay *= 0.95;

            let current_time = Date.now();

            for (let i = 0; i < this.children.length; i++) {
                let parts_group = this.children[i];
                for (let i2 = 0; i2 < parts_group.children.length; i2++) {
                    let piece = parts_group.children[i2];
                    piece.position.x += (piece.userData.x * speed_factor);
                    piece.position.y += (piece.userData.y * speed_factor);
                    piece.position.z += (piece.userData.z * speed_factor);
                    piece.rotateX(piece.userData.rx * spin_factor);
                    piece.rotateY(piece.userData.ry * spin_factor);
                    piece.rotateZ(piece.userData.rz * spin_factor);
    
                    piece.scale.set(scale_factor, scale_factor, scale_factor)
                    let elapsed_time = (current_time - piece.explode_time) / 1000;
                    if (elapsed_time >= piece.burn_time) {
                        piece.visible = false;
                    }
                }
            }
    
            if (this.explosion_decay < 0.1) {
                Game.scene.remove(this);
                Alien.sprites.delete(this.uuid);
            }
        
        }
    
        appear() {
            this.appear_time = null;
            Game.scene.attach(this);
            this.visible = true;
        }
        
        teleport_in() {
            this.appear_time = null;
            this.is_teleporting_in = true;
            Sounds.play("teleport_in", this.position);
            this.userData.teleport_rings = [];
            let scale = 1 / 128;
            this.scale.set(scale, scale, scale);
            Game.scene.attach(this);
            this.visible = true;
        }

        static teleport_ring_geometry = new THREE.RingGeometry(0.5, 0.45, 32);
        
        animate_teleporting_in() {
    
            let scale, teleport_ring;
    
            scale = this.scale.x;
            if (scale < 1 - 0.05) {
                
                scale = this.scale.x + 0.05;
                if (scale >= 1) {
                    scale = 1;
                }
                this.scale.set(scale, scale, scale);
    
                if (scale <= 0.5) {
                    const material = new THREE.MeshBasicMaterial({
                        color: "#FFFFFF",
                        side: THREE.DoubleSide,
                        // transparent: true,
                        // opacity: 1
                    });
                    teleport_ring = new THREE.Mesh(Alien.teleport_ring_geometry, material);
                    teleport_ring.position.z -= 0.5;
                    this.add(teleport_ring);
                    Game.scene.attach(teleport_ring);
                    this.userData.teleport_rings.push(teleport_ring);
                }
            }

            if (this.userData.teleport_rings.length > 0) {
                for (let i = 0; i < this.userData.teleport_rings.length; i++) {
                    this.userData.teleport_rings[i].material.opacity -= .08;
                }
                if (this.userData.teleport_rings[0].material.opacity <= 0) {
                    teleport_ring = this.userData.teleport_rings.shift();
                    Game.scene.remove(teleport_ring);
                }
            }
    
            if (this.userData.teleport_rings.length === 0) {
                delete(this.userData.teleport_rings);
                this.is_teleporting_in = false;
            }
            
        }
    
        teleport_out() {
            this.is_teleporting_out = true;
            Sounds.play("teleport_out", this.position);
            this.userData.teleport_rings = [];
        }
    
    
        animate_teleporting_out() {
            let scale, teleport_ring;
    
            scale = this.scale.x;
            if (scale > 0.05) {
        
                scale = this.scale.x - 0.05;
                this.scale.set(scale, scale, scale);
        
                if (scale >= 0.5) {
                    const material = new THREE.MeshBasicMaterial({
                        color: "#FFFFFF",
                        side: THREE.DoubleSide,
                        transparent: true,
                        opacity: 1
                    });
                    teleport_ring = new THREE.Mesh(Alien.teleport_ring_geometry, material);
                    teleport_ring.position.z -= 0.5;
                    this.add(teleport_ring);
                    Game.scene.attach(teleport_ring);
                    this.userData.teleport_rings.push(teleport_ring);
                }
            }
    
            if (this.userData.teleport_rings.length > 0) {
                for (let i = 0; i < this.userData.teleport_rings.length; i++) {
                    this.userData.teleport_rings[i].material.opacity -= .08;
                }
                if (this.userData.teleport_rings[0].material.opacity <= 0) {
                    teleport_ring = this.userData.teleport_rings.shift();
                    Game.scene.remove(teleport_ring);
                }
            }
    
            if (this.userData.teleport_rings.length === 0) {
                delete(this.userData.teleport_rings);
                this.is_teleporting_out = false;
                this.visible = false;
                Alien.sprites.delete(this.uuid);
                Game.scene.remove(this);
            }
        }
    
    
        static next_alien_type = 1;
        static get_next_alien_type() {
            let max_alien_type = Level.get_max_alien_type();
            let alien_type = Alien.next_alien_type;
            Alien.next_alien_type++;
            if (Alien.next_alien_type > max_alien_type) {
                Alien.next_alien_type = 1;
            }
            
            return alien_type;
        }
    
    
        static launch_missiles(interval_length) {
            let max_missiles = Level.get_max_missiles();
            let current_missiles = 0;
            let num_aliens = 0;
            for (let sprite of Alien.sprites.values()) {
                if (sprite.userData.is_missile) {
                    current_missiles ++;
                }
                num_aliens++;
            }

            let chances_of_missle = interval_length * 1000;
            if (current_missiles < max_missiles) {
                if (Utils.get_random_number(0,750) < chances_of_missle) {
                    let launch_sprite = Utils.get_random_number(0, num_aliens - 1);
                    let sprite_num = 0;
                    for (let sprite of Alien.sprites.values()) {
                        if (sprite.userData.is_missile) {
                            continue;
                        }
                        if (sprite_num === launch_sprite) {
                            sprite.launch_missile();
                            return;
                        }
                    }
                }
            }
        }
        
        launch_missile() {
            if (!this.last_position) {
                return;
            }
            let options = {
                type: 40,
                speed: 0.5,
                path: 50,
                path_options: {
                    start_position: this.last_position
                },
                do_teleport: false,
            };
            let missile = new Alien(options);
            missile.userData.is_missile = true;
            Sounds.play("missile_launch", missile.position);
            Sounds.play("missile_alert", missile.position);
        }
        
        static spawn_boss(delay) {
            Level.boss_destroyed = false;
            let level_config = Level.levels.get(Level.current_level);
            let options = {
                type: level_config.boss_type,
                path: level_config.boss_path,
                speed: 0.5,
                // path: 99,
                appear_time: Date.now() + delay,
                do_teleport: true,
            };
    
            let alien = new Alien(options);
            alien.name = "boss";
    
            let num_squadrons = Level.current_level;
            let num_aliens_per_squadron = 1;
            let appear_time = Date.now() + delay;
            let appear_time_interval = 125 / Level.get_level_speed();
    
            for (let squadron_num = 0; squadron_num < num_squadrons; squadron_num++) {
                let alien_type = Alien.get_next_alien_type();
                Alien.spawn_squadron(num_aliens_per_squadron, alien_type, appear_time, appear_time_interval)
                appear_time += (num_aliens_per_squadron * appear_time_interval);
                appear_time += appear_time_interval;
            }
            
        }
        
        static spawn_squadrons(num_squadrons, delay) {
        
            if (!delay) {
                delay = 0;
            }
    
            let num_aliens_per_squadron = Level.get_num_aliens_per_squadron();
            let appear_time = Date.now() + delay;
            let appear_time_interval = 125 / Level.get_level_speed();
        
            for (let squadron_num = 0; squadron_num < num_squadrons; squadron_num++) {
                let alien_type = Alien.get_next_alien_type();
                Alien.spawn_squadron(num_aliens_per_squadron, alien_type, appear_time, appear_time_interval)
                appear_time += (num_aliens_per_squadron * appear_time_interval);
                appear_time += 500 * Utils.get_random_number(1,4);
            }
        
        }
    
        static spawn_squadron(num_aliens, alien_type, appear_time, appear_time_interval) {
            if (!appear_time) {
                appear_time = Date.now();
            }
            if (!appear_time_interval) {
                appear_time_interval = 125 / Level.get_level_speed();
            }
        
            let path = Utils.get_random_number(1,12);
            for (let i = 0; i < num_aliens; i++) {
    
                let options = {
                    type: alien_type,
                    speed: Level.get_level_speed(),
                    path: path,
                    appear_time: appear_time,
                    do_teleport: true,
                };
                new Alien(options);

                appear_time += appear_time_interval;
            }
        }
        
        
        static aliens = new Map();
        static minion_alien_type_ids = [];
        
        static init() {
    
            for (let c = 0; c < Alien.aliens_config.length; c++) {
    
                let alien_config = Alien.aliens_config[c];
    
                // move to center
                let min_x = null;
                let min_y = null;
                let min_z = null;
                let max_x = null;
                let max_y = null;
                let max_z = null;
                for (let f = 0; f < alien_config.parts.length; f++) {
                    for (let i = 0; i < alien_config.parts[f].length; i++) {
            
                        let x = alien_config.parts[f][i][0];
                        let y = alien_config.parts[f][i][1];
                        let z = alien_config.parts[f][i][2];
            
                        if (min_x === null || x < min_x) {
                            min_x = x;
                        }
                        if (min_y === null || y < min_y) {
                            min_y = y;
                        }
                        if (min_z === null || z < min_z) {
                            min_z = z;
                        }
                        if (max_x === null || x > max_x) {
                            max_x = x;
                        }
                        if (max_y === null || y > max_y) {
                            max_y = y;
                        }
                        if (max_z === null || z > max_z) {
                            max_z = z;
                        }
                    }
                }
    
                let offset_x = 0 - ((min_x + max_x) / 2);
                let offset_y = 0 - ((min_y + max_y) / 2);
                let offset_z = 0 - ((min_z + max_z) / 2);

                for (let f = 0; f < alien_config.parts.length; f++) {
                    for (let i = 0; i < alien_config.parts[f].length; i++) {
                        alien_config.parts[f][i][0] += offset_x;
                        alien_config.parts[f][i][1] += offset_y;
                        alien_config.parts[f][i][2] += offset_z;
                    }
                }
    
                // flip as needed
                for (let f = 0; f < alien_config.parts.length; f++) {
                    for (let i = 0; i < alien_config.parts[f].length; i++) {
                        if (alien_config.flip_x) {
                            alien_config.parts[f][i][0] *= -1;
                        }
                        if (alien_config.flip_y) {
                            alien_config.parts[f][i][1] *= -1
                        }
                        if (alien_config.flip_z) {
                            alien_config.parts[f][i][2] *= -1;
                        }
                    }
                }

                // resize
                for (let f = 0; f < alien_config.parts.length; f++) {
                    for (let i = 0; i < alien_config.parts[f].length; i++) {
                        alien_config.parts[f][i][0] *= Alien.voxel_size;
                        alien_config.parts[f][i][1] *= Alien.voxel_size;
                        alien_config.parts[f][i][2] *= Alien.voxel_size;
                    }
                }
    
                Alien.aliens.set(alien_config.type_id, alien_config);
                if (alien_config.is_minion) {
                    Alien.minion_alien_type_ids.push(alien_config.type_id);
                }
            }
            
        }
        
        static aliens_config = [
            {
                type_id: 1,
                is_minion: true,
                has_kill_block: false,
                flip_z: true,
                parts:
                [
                    [
                        [-2,2,0, "green"],
                        [1,2,0, "green"],
                        [0,1,-1, "blue"],
                        [0,1,0, "blue"],
                        [-1,1,-1, "blue"],
                        [-1,1,0, "blue"],
                        [0,0,-1, "blue"],
                        [0,0,0, "blue"],
                        [-1,0,-1, "blue"],
                        [-1,0,0, "blue"],
                        [-2,0,-1, "red"],
                        [-2,0,0, "red"],
                        [1,0,-1, "red"],
                        [1,0,0, "red"],
                        [-3,-1,-2, "red"],
                        [-3,-1,1, "red"],
                        [2,-1,-2, "red"],
                        [2,-1,1, "red"],
                        [-3,-2,-2, "red"],
                        [-3,-2,1, "red"],
                        [2,-2,-2, "red"],
                        [2,-2,1, "red"],
                    ],
                ]
            },
            
            {
                type_id: 2,
                is_minion: true,
                has_kill_block: false,
                flip_z: true,
                parts:[
                    [
                        [1, 1, 3, "teal"],
                        [2, 1, 3, "teal"],
                        [6, 1, 3, "teal"],
                        [7, 1, 3, "teal"],
                        [1, 1, 2, "teal"],
                        [7, 1, 2, "teal"],
                        [1, 1, 0, "teal"],
                        [7, 1, 0, "teal"],
                
                        [4, 1, 2, "black"],
                
                        [2, 2, 3, "teal"],
                        [6, 2, 3, "teal"],
                        [4, 2, 2, "teal"],
                        [1, 2, 1, "teal"],
                        [7, 2, 1, "teal"],
                
                        [1, 3, 3, "teal"],
                        [2, 3, 3, "teal"],
                        [3, 3, 3, "teal"],
                        [4, 3, 3, "teal"],
                        [5, 3, 3, "teal"],
                        [6, 3, 3, "teal"],
                        [7, 3, 3, "teal"],
                
                        [1, 3, 2, "teal"],
                        [3, 3, 2, "teal"],
                        [4, 3, 2, "teal"],
                        [5, 3, 2, "teal"],
                        [7, 3, 2, "teal"],
                
                        [1, 3, 1, "teal"],
                        [4, 3, 1, "teal"],
                        [7, 3, 1, "teal"],
                
                        [2, 4, 3, "green"],
                        [3, 4, 3, "teal"],
                        [4, 4, 3, "green"],
                        [5, 4, 3, "teal"],
                        [6, 4, 3, "green"],
                
                        [2, 4, 2, "teal"],
                        [3, 4, 2, "teal"],
                        [4, 4, 2, "teal"],
                        [5, 4, 2, "teal"],
                        [6, 4, 2, "teal"],
                
                        [2, 5, 3, "teal"],
                        [3, 5, 3, "teal"],
                        [4, 5, 3, "teal"],
                        [5, 5, 3, "teal"],
                        [6, 5, 3, "teal"],
                
                        [2, 5, 2, "teal"],
                        [4, 5, 2, "teal"],
                        [6, 5, 2, "teal"],
                    ],
                ]
            },
    
            {
                type_id: 3,
                is_minion: true,
                has_kill_block: false,
                flip_z: true,
                parts: [
                    [
                        [4, 1, 3, "blue"],
                        [4, 1, 2, "blue"],
                        [4, 1, 1, "blue"],
                        [6, 1, 3, "blue"],
                        [6, 1, 2, "blue"],
                        [6, 1, 1, "blue"],
                
                        [3, 2, 3, "blue"],
                        [4, 2, 3, "blue"],
                        [5, 2, 3, "blue"],
                        [6, 2, 3, "blue"],
                        [7, 2, 3, "blue"],
                        [3, 2, 2, "blue"],
                        [4, 2, 2, "blue"],
                        [5, 2, 2, "blue"],
                        [6, 2, 2, "blue"],
                        [7, 2, 2, "blue"],
                        [3, 2, 1, "blue"],
                        [4, 2, 1, "blue"],
                        [5, 2, 1, "blue"],
                        [6, 2, 1, "blue"],
                        [7, 2, 1, "blue"],
                
                        [3, 3, 3, "blue"],
                        [4, 3, 3, "red"],
                        [5, 3, 3, "blue"],
                        [6, 3, 3, "red"],
                        [7, 3, 3, "blue"],
                        [3, 3, 2, "blue"],
                        [4, 3, 2, "blue"],
                        [5, 3, 2, "blue"],
                        [6, 3, 2, "blue"],
                        [7, 3, 2, "blue"],
                        [3, 3, 1, "blue"],
                        [4, 3, 1, "blue"],
                        [5, 3, 1, "blue"],
                        [6, 3, 1, "blue"],
                        [7, 3, 1, "blue"],
                
                        [3, 4, 3, "blue"],
                        [4, 4, 3, "blue"],
                        [5, 4, 3, "blue"],
                        [6, 4, 3, "blue"],
                        [7, 4, 3, "blue"],
                        [3, 4, 2, "blue"],
                        [4, 4, 2, "blue"],
                        [5, 4, 2, "blue"],
                        [6, 4, 2, "blue"],
                        [7, 4, 2, "blue"],
                        [3, 4, 1, "blue"],
                        [4, 4, 1, "blue"],
                        [5, 4, 1, "blue"],
                        [6, 4, 1, "blue"],
                        [7, 4, 1, "blue"],
                
                        [2, 4, 3, "teal"],
                        [8, 4, 3, "teal"],
                
                        [1, 5, 3, "teal"],
                        [2, 5, 3, "teal"],
                        [3, 5, 3, "teal"],
                
                        [7, 5, 3, "teal"],
                        [8, 5, 3, "teal"],
                        [9, 5, 3, "teal"],
                
                        [1, 6, 3, "teal"],
                        [9, 6, 3, "teal"],
                    ],
                ]
            },
            
            {
                type_id: 4,
                is_minion: true,
                has_kill_block: false,
                flip_z: true,
                parts: [
                    [
                        [1, 1, 7, "yellow"],
                        [7, 1, 7, "yellow"],
                        [1, 1, 5, "yellow"],
                        [7, 1, 5, "yellow"],
                        [1, 1, 3, "yellow"],
                        [7, 1, 3, "yellow"],
                        [1, 1, 1, "yellow"],
                        [7, 1, 1, "yellow"],
                
                        [1, 2, 7, "yellow"],
                        [7, 2, 7, "yellow"],
                        [1, 2, 5, "yellow"],
                        [7, 2, 5, "yellow"],
                        [1, 2, 3, "yellow"],
                        [7, 2, 3, "yellow"],
                        [1, 2, 1, "yellow"],
                        [7, 2, 1, "yellow"],
                
                        [2, 3, 7, "yellow"],
                        [3, 3, 7, "yellow"],
                        [4, 3, 7, "yellow"],
                        [5, 3, 7, "yellow"],
                        [6, 3, 7, "yellow"],
                
                        [2, 3, 5, "yellow"],
                        [3, 3, 5, "yellow"],
                        [4, 3, 5, "yellow"],
                        [5, 3, 5, "yellow"],
                        [6, 3, 5, "yellow"],
                
                        [2, 3, 3, "yellow"],
                        [3, 3, 3, "yellow"],
                        [4, 3, 3, "yellow"],
                        [5, 3, 3, "yellow"],
                        [6, 3, 3, "yellow"],
                
                        [2, 3, 1, "yellow"],
                        [3, 3, 1, "yellow"],
                        [4, 3, 1, "yellow"],
                        [5, 3, 1, "yellow"],
                        [6, 3, 1, "yellow"],
                
                        [5, 3, 5, "yellow"],
                        [5, 3, 4, "yellow"],
                        [5, 3, 3, "yellow"],
                        [5, 3, 2, "yellow"],
                        [5, 3, 1, "yellow"],
                
                        [4, 4, 6, "yellow"],
                
                        [3, 5, 6, "yellow"],
                        [4, 5, 6, "yellow"],
                        [5, 5, 6, "yellow"],
                
                        [3, 5, 7, "green"],
                        [5, 5, 7, "green"],
                    ],
                ]
            },
    
            {
                type_id: 5,
                is_minion: true,
                has_kill_block: false,
                flip_z: true,
                parts: [
                    [
                        [4, 1, 4, "white"],
                        [5, 1, 4, "white"],
                        [3, 1, 4, "white"],
                        [6, 1, 4, "white"],
                        [2, 2, 4, "white"],
                        [7, 2, 4, "white"],
                
                        [1, 3, 4, "white"],
                        [8, 3, 4, "white"],
                        [1, 4, 4, "white"],
                        [8, 4, 4, "white"],
                        [1, 5, 4, "white"],
                        [8, 5, 4, "white"],
                
                        [2, 6, 4, "white"],
                        [7, 6, 4, "white"],
                
                        [4, 7, 4, "white"],
                        [5, 7, 4, "white"],
                
                        [4, 7, 3, "white"],
                        [5, 7, 3, "white"],
                
                        [4, 6, 2, "white"],
                        [5, 6, 2, "white"],
                        [4, 6, 1, "white"],
                        [5, 6, 1, "white"],
                        [4, 6, 0, "white"],
                        [5, 6, 0, "white"],
                
                        [4, 7, -1, "white"],
                        [5, 7, -1, "white"],
                
                        [4, 6, -2, "white"],
                        [5, 6, -2, "white"],
                        [4, 6, -3, "white"],
                        [5, 6, -3, "white"],
                
                        [4, 5, -4, "white"],
                        [5, 5, -4, "white"],
                        [4, 5, -5, "white"],
                        [5, 5, -5, "white"],
                
                        [2, 7, 4, "red"],
                        [3, 7, 4, "red"],
                        [6, 7, 4, "red"],
                        [7, 7, 4, "red"],
                        [2, 8, 4, "red"],
                        [3, 8, 4, "red"],
                        [6, 8, 4, "red"],
                        [7, 8, 4, "red"],
                    ],
                ],
            },
    
            // level boss
            {
                type_id: 20,
                is_minion: false,
                has_kill_block: true,
                flip_z: true,
                time_per_frame: [500,500],
                parts: [
    
                    [
                        [3, 0, 0, "white", false], [4, 0, 0, "white", false], [7, 0, 0, "white", false], [8, 0, 0, "white", false], [5, 0, 1, "white", false], [6, 0, 1, "white", false], [5, 0, 2, "white", false], [6, 0, 2, "white", false], [0, 0, 3, "white", false], [5, 0, 3, "white", false],
                        [6, 0, 3, "white", false], [11, 0, 3, "white", false], [0, 0, 4, "white", false], [5, 0, 4, "white", false], [6, 0, 4, "white", false], [11, 0, 4, "white", false], [1, 0, 5, "white", false], [2, 0, 5, "white", false], [3, 0, 5, "white", false], [4, 0, 5, "white", false],
                        [5, 0, 5, "white", false], [6, 0, 5, "white", false], [7, 0, 5, "white", false], [8, 0, 5, "white", false], [9, 0, 5, "white", false], [10, 0, 5, "white", false], [1, 0, 6, "white", false], [2, 0, 6, "white", false], [3, 0, 6, "white", false], [4, 0, 6, "white", false],
                        [5, 0, 6, "white", false], [6, 0, 6, "white", false], [7, 0, 6, "white", false], [8, 0, 6, "white", false], [9, 0, 6, "white", false], [10, 0, 6, "white", false], [0, 0, 7, "white", false], [5, 0, 7, "white", false], [6, 0, 7, "white", false], [11, 0, 7, "white", false],
                        [0, 0, 8, "white", false], [5, 0, 8, "white", false], [6, 0, 8, "white", false], [11, 0, 8, "white", false], [5, 0, 9, "white", false], [6, 0, 9, "white", false], [5, 0, 10, "white", false], [6, 0, 10, "white", false], [3, 0, 11, "white", false], [4, 0, 11, "white", false],
                        [7, 0, 11, "white", false], [8, 0, 11, "white", false], [0, 1, 0, "white", false], [2, 1, 0, "white", false], [9, 1, 0, "white", false], [11, 1, 0, "white", false], [3, 1, 1, "black", false], [4, 1, 1, "black", false], [5, 1, 1, "black", false], [6, 1, 1, "black", false],
                        [7, 1, 1, "black", false], [8, 1, 1, "black", false], [0, 1, 2, "white", false], [2, 1, 2, "black", false], [3, 1, 2, "black", false], [4, 1, 2, "black", false], [5, 1, 2, "black", false], [6, 1, 2, "black", false], [7, 1, 2, "black", false], [8, 1, 2, "black", false],
                        [9, 1, 2, "black", false], [11, 1, 2, "white", false], [1, 1, 3, "black", false], [2, 1, 3, "black", false], [3, 1, 3, "black", false], [4, 1, 3, "black", false], [5, 1, 3, "black", false], [6, 1, 3, "black", false], [7, 1, 3, "black", false], [8, 1, 3, "black", false],
                        [9, 1, 3, "black", false], [10, 1, 3, "black", false], [1, 1, 4, "black", false], [2, 1, 4, "black", false], [3, 1, 4, "black", false], [4, 1, 4, "black", false], [5, 1, 4, "black", false], [6, 1, 4, "black", false], [7, 1, 4, "black", false], [8, 1, 4, "black", false],
                        [9, 1, 4, "black", false], [10, 1, 4, "black", false], [1, 1, 5, "black", false], [2, 1, 5, "black", false], [3, 1, 5, "black", false], [4, 1, 5, "black", false], [5, 1, 5, "black", false], [6, 1, 5, "black", false], [7, 1, 5, "black", false], [8, 1, 5, "black", false],
                        [9, 1, 5, "black", false], [10, 1, 5, "black", false], [1, 1, 6, "black", false], [2, 1, 6, "black", false], [3, 1, 6, "black", false], [4, 1, 6, "black", false], [5, 1, 6, "black", false], [6, 1, 6, "black", false], [7, 1, 6, "black", false], [8, 1, 6, "black", false],
                        [9, 1, 6, "black", false], [10, 1, 6, "black", false], [1, 1, 7, "black", false], [2, 1, 7, "black", false], [3, 1, 7, "black", false], [4, 1, 7, "black", false], [5, 1, 7, "black", false], [6, 1, 7, "black", false], [7, 1, 7, "black", false], [8, 1, 7, "black", false],
                        [9, 1, 7, "black", false], [10, 1, 7, "black", false], [1, 1, 8, "black", false], [2, 1, 8, "black", false], [3, 1, 8, "black", false], [4, 1, 8, "black", false], [5, 1, 8, "black", false], [6, 1, 8, "black", false], [7, 1, 8, "black", false], [8, 1, 8, "black", false],
                        [9, 1, 8, "black", false], [10, 1, 8, "black", false], [0, 1, 9, "white", false], [2, 1, 9, "black", false], [3, 1, 9, "black", false], [4, 1, 9, "black", false], [5, 1, 9, "black", false], [6, 1, 9, "black", false], [7, 1, 9, "black", false], [8, 1, 9, "black", false],
                        [9, 1, 9, "black", false], [11, 1, 9, "white", false], [3, 1, 10, "black", false], [4, 1, 10, "black", false], [5, 1, 10, "black", false], [6, 1, 10, "black", false], [7, 1, 10, "black", false], [8, 1, 10, "black", false], [0, 1, 11, "white", false], [2, 1, 11, "white", false],
                        [9, 1, 11, "white", false], [11, 1, 11, "white", false], [2, 2, 0, "white", false], [3, 2, 0, "white", false], [4, 2, 0, "white", false], [5, 2, 0, "white", false], [6, 2, 0, "white", false], [7, 2, 0, "white", false], [8, 2, 0, "white", false], [9, 2, 0, "white", false],
                        [3, 2, 1, "black", false], [4, 2, 1, "black", false], [5, 2, 1, "black", false], [6, 2, 1, "black", false], [7, 2, 1, "black", false], [8, 2, 1, "black", false], [0, 2, 2, "white", false], [2, 2, 2, "black", false], [3, 2, 2, "red", true], [4, 2, 2, "red", true],
                        [5, 2, 2, "red", true], [6, 2, 2, "red", true], [7, 2, 2, "red", true], [8, 2, 2, "red", true], [9, 2, 2, "black", false], [11, 2, 2, "white", false], [0, 2, 3, "white", false], [1, 2, 3, "black", false], [2, 2, 3, "red", true], [3, 2, 3, "red", true],
                        [4, 2, 3, "red", true], [5, 2, 3, "red", true], [6, 2, 3, "red", true], [7, 2, 3, "red", true], [8, 2, 3, "red", true], [9, 2, 3, "red", true], [10, 2, 3, "black", false], [11, 2, 3, "white", false], [0, 2, 4, "white", false], [1, 2, 4, "black", false],
                        [2, 2, 4, "red", true], [3, 2, 4, "red", true], [4, 2, 4, "red", true], [5, 2, 4, "red", true], [6, 2, 4, "red", true], [7, 2, 4, "red", true], [8, 2, 4, "red", true], [9, 2, 4, "red", true], [10, 2, 4, "black", false], [11, 2, 4, "white", false],
                        [0, 2, 5, "white", false], [1, 2, 5, "black", false], [2, 2, 5, "red", true], [3, 2, 5, "red", true], [4, 2, 5, "red", true], [5, 2, 5, "red", true], [6, 2, 5, "red", true], [7, 2, 5, "red", true], [8, 2, 5, "red", true], [9, 2, 5, "red", true],
                        [10, 2, 5, "black", false], [11, 2, 5, "white", false], [0, 2, 6, "white", false], [1, 2, 6, "black", false], [2, 2, 6, "red", true], [3, 2, 6, "red", true], [4, 2, 6, "red", true], [5, 2, 6, "red", true], [6, 2, 6, "red", true], [7, 2, 6, "red", true],
                        [8, 2, 6, "red", true], [9, 2, 6, "red", true], [10, 2, 6, "black", false], [11, 2, 6, "white", false], [0, 2, 7, "white", false], [1, 2, 7, "black", false], [2, 2, 7, "red", true], [3, 2, 7, "red", true], [4, 2, 7, "red", true], [5, 2, 7, "red", true],
                        [6, 2, 7, "red", true], [7, 2, 7, "red", true], [8, 2, 7, "red", true], [9, 2, 7, "red", true], [10, 2, 7, "black", false], [11, 2, 7, "white", false], [0, 2, 8, "white", false], [1, 2, 8, "black", false], [2, 2, 8, "red", true], [3, 2, 8, "red", true],
                        [4, 2, 8, "red", true], [5, 2, 8, "red", true], [6, 2, 8, "red", true], [7, 2, 8, "red", true], [8, 2, 8, "red", true], [9, 2, 8, "red", true], [10, 2, 8, "black", false], [11, 2, 8, "white", false], [0, 2, 9, "white", false], [2, 2, 9, "black", false],
                        [3, 2, 9, "red", true], [4, 2, 9, "red", true], [5, 2, 9, "red", true], [6, 2, 9, "red", true], [7, 2, 9, "red", true], [8, 2, 9, "red", true], [9, 2, 9, "black", false], [11, 2, 9, "white", false], [3, 2, 10, "black", false], [4, 2, 10, "black", false],
                        [5, 2, 10, "black", false], [6, 2, 10, "black", false], [7, 2, 10, "black", false], [8, 2, 10, "black", false], [2, 2, 11, "white", false], [3, 2, 11, "white", false], [4, 2, 11, "white", false], [5, 2, 11, "white", false], [6, 2, 11, "white", false], [7, 2, 11, "white", false],
                        [8, 2, 11, "white", false], [9, 2, 11, "white", false], [2, 3, 0, "white", false], [3, 3, 0, "white", false], [4, 3, 0, "white", false], [5, 3, 0, "white", false], [6, 3, 0, "white", false], [7, 3, 0, "white", false], [8, 3, 0, "white", false], [9, 3, 0, "white", false],
                        [3, 3, 1, "black", false], [4, 3, 1, "black", false], [5, 3, 1, "black", false], [6, 3, 1, "black", false], [7, 3, 1, "black", false], [8, 3, 1, "black", false], [0, 3, 2, "white", false], [2, 3, 2, "black", false], [3, 3, 2, "red", true], [4, 3, 2, "red", true],
                        [5, 3, 2, "red", true], [6, 3, 2, "red", true], [7, 3, 2, "red", true], [8, 3, 2, "red", true], [9, 3, 2, "black", false], [11, 3, 2, "white", false], [0, 3, 3, "white", false], [1, 3, 3, "black", false], [2, 3, 3, "red", true], [3, 3, 3, "red", true],
                        [4, 3, 3, "red", true], [5, 3, 3, "red", true], [6, 3, 3, "red", true], [7, 3, 3, "red", true], [8, 3, 3, "red", true], [9, 3, 3, "red", true], [10, 3, 3, "black", false], [11, 3, 3, "white", false], [0, 3, 4, "white", false], [1, 3, 4, "black", false],
                        [2, 3, 4, "red", true], [3, 3, 4, "red", true], [4, 3, 4, "red", true], [5, 3, 4, "red", true], [6, 3, 4, "red", true], [7, 3, 4, "red", true], [8, 3, 4, "red", true], [9, 3, 4, "red", true], [10, 3, 4, "black", false], [11, 3, 4, "white", false],
                        [0, 3, 5, "white", false], [1, 3, 5, "black", false], [2, 3, 5, "red", true], [3, 3, 5, "red", true], [4, 3, 5, "red", true], [5, 3, 5, "red", true], [6, 3, 5, "red", true], [7, 3, 5, "red", true], [8, 3, 5, "red", true], [9, 3, 5, "red", true],
                        [10, 3, 5, "black", false], [11, 3, 5, "white", false], [0, 3, 6, "white", false], [1, 3, 6, "black", false], [2, 3, 6, "red", true], [3, 3, 6, "red", true], [4, 3, 6, "red", true], [5, 3, 6, "red", true], [6, 3, 6, "red", true], [7, 3, 6, "red", true],
                        [8, 3, 6, "red", true], [9, 3, 6, "red", true], [10, 3, 6, "black", false], [11, 3, 6, "white", false], [0, 3, 7, "white", false], [1, 3, 7, "black", false], [2, 3, 7, "red", true], [3, 3, 7, "red", true], [4, 3, 7, "red", true], [5, 3, 7, "red", true],
                        [6, 3, 7, "red", true], [7, 3, 7, "red", true], [8, 3, 7, "red", true], [9, 3, 7, "red", true], [10, 3, 7, "black", false], [11, 3, 7, "white", false], [0, 3, 8, "white", false], [1, 3, 8, "black", false], [2, 3, 8, "red", true], [3, 3, 8, "red", true],
                        [4, 3, 8, "red", true], [5, 3, 8, "red", true], [6, 3, 8, "red", true], [7, 3, 8, "red", true], [8, 3, 8, "red", true], [9, 3, 8, "red", true], [10, 3, 8, "black", false], [11, 3, 8, "white", false], [0, 3, 9, "white", false], [2, 3, 9, "black", false],
                        [3, 3, 9, "red", true], [4, 3, 9, "red", true], [5, 3, 9, "red", true], [6, 3, 9, "red", true], [7, 3, 9, "red", true], [8, 3, 9, "red", true], [9, 3, 9, "black", false], [11, 3, 9, "white", false], [3, 3, 10, "black", false], [4, 3, 10, "black", false],
                        [5, 3, 10, "black", false], [6, 3, 10, "black", false], [7, 3, 10, "black", false], [8, 3, 10, "black", false], [2, 3, 11, "white", false], [3, 3, 11, "white", false], [4, 3, 11, "white", false], [5, 3, 11, "white", false], [6, 3, 11, "white", false], [7, 3, 11, "white", false],
                        [8, 3, 11, "white", false], [9, 3, 11, "white", false], [0, 4, 0, "white", false], [1, 4, 0, "white", false], [2, 4, 0, "white", false], [4, 4, 0, "white", false], [5, 4, 0, "white", false], [6, 4, 0, "white", false], [7, 4, 0, "white", false], [9, 4, 0, "white", false],
                        [10, 4, 0, "white", false], [11, 4, 0, "white", false], [0, 4, 1, "white", false], [3, 4, 1, "black", false], [4, 4, 1, "black", false], [5, 4, 1, "black", false], [6, 4, 1, "black", false], [7, 4, 1, "black", false], [8, 4, 1, "black", false], [11, 4, 1, "white", false],
                        [0, 4, 2, "white", false], [2, 4, 2, "black", false], [3, 4, 2, "black", false], [4, 4, 2, "black", false], [5, 4, 2, "black", false], [6, 4, 2, "black", false], [7, 4, 2, "black", false], [8, 4, 2, "black", false], [9, 4, 2, "black", false], [11, 4, 2, "white", false],
                        [1, 4, 3, "black", false], [2, 4, 3, "black", false], [3, 4, 3, "black", false], [4, 4, 3, "red", true], [5, 4, 3, "red", true], [6, 4, 3, "red", true], [7, 4, 3, "red", true], [8, 4, 3, "black", false], [9, 4, 3, "black", false], [10, 4, 3, "black", false],
                        [0, 4, 4, "white", false], [1, 4, 4, "black", false], [2, 4, 4, "black", false], [3, 4, 4, "red", true], [4, 4, 4, "red", true], [5, 4, 4, "red", true], [6, 4, 4, "red", true], [7, 4, 4, "red", true], [8, 4, 4, "red", true], [9, 4, 4, "black", false],
                        [10, 4, 4, "black", false], [11, 4, 4, "white", false], [0, 4, 5, "white", false], [1, 4, 5, "black", false], [2, 4, 5, "black", false], [3, 4, 5, "red", true], [4, 4, 5, "red", true], [5, 4, 5, "red", true], [6, 4, 5, "red", true], [7, 4, 5, "red", true],
                        [8, 4, 5, "red", true], [9, 4, 5, "black", false], [10, 4, 5, "black", false], [11, 4, 5, "white", false], [0, 4, 6, "white", false], [1, 4, 6, "black", false], [2, 4, 6, "black", false], [3, 4, 6, "red", true], [4, 4, 6, "red", true], [5, 4, 6, "red", true],
                        [6, 4, 6, "red", true], [7, 4, 6, "red", true], [8, 4, 6, "red", true], [9, 4, 6, "black", false], [10, 4, 6, "black", false], [11, 4, 6, "white", false], [0, 4, 7, "white", false], [1, 4, 7, "black", false], [2, 4, 7, "black", false], [3, 4, 7, "red", true],
                        [4, 4, 7, "red", true], [5, 4, 7, "red", true], [6, 4, 7, "red", true], [7, 4, 7, "red", true], [8, 4, 7, "red", true], [9, 4, 7, "black", false], [10, 4, 7, "black", false], [11, 4, 7, "white", false], [1, 4, 8, "black", false], [2, 4, 8, "black", false],
                        [3, 4, 8, "black", false], [4, 4, 8, "red", true], [5, 4, 8, "red", true], [6, 4, 8, "red", true], [7, 4, 8, "red", true], [8, 4, 8, "black", false], [9, 4, 8, "black", false], [10, 4, 8, "black", false], [0, 4, 9, "white", false], [2, 4, 9, "black", false],
                        [3, 4, 9, "black", false], [4, 4, 9, "black", false], [5, 4, 9, "black", false], [6, 4, 9, "black", false], [7, 4, 9, "black", false], [8, 4, 9, "black", false], [9, 4, 9, "black", false], [11, 4, 9, "white", false], [0, 4, 10, "white", false], [3, 4, 10, "black", false],
                        [4, 4, 10, "black", false], [5, 4, 10, "black", false], [6, 4, 10, "black", false], [7, 4, 10, "black", false], [8, 4, 10, "black", false], [11, 4, 10, "white", false], [0, 4, 11, "white", false], [1, 4, 11, "white", false], [2, 4, 11, "white", false], [4, 4, 11, "white", false],
                        [5, 4, 11, "white", false], [6, 4, 11, "white", false], [7, 4, 11, "white", false], [9, 4, 11, "white", false], [10, 4, 11, "white", false], [11, 4, 11, "white", false], [2, 5, 0, "white", false], [3, 5, 0, "white", false], [4, 5, 0, "white", false], [5, 5, 0, "white", false],
                        [6, 5, 0, "white", false], [7, 5, 0, "white", false], [8, 5, 0, "white", false], [9, 5, 0, "white", false], [0, 5, 2, "white", false], [11, 5, 2, "white", false], [0, 5, 3, "white", false], [11, 5, 3, "white", false], [0, 5, 4, "white", false], [11, 5, 4, "white", false],
                        [0, 5, 5, "white", false], [11, 5, 5, "white", false], [0, 5, 6, "white", false], [11, 5, 6, "white", false], [0, 5, 7, "white", false], [11, 5, 7, "white", false], [0, 5, 8, "white", false], [11, 5, 8, "white", false], [0, 5, 9, "white", false], [11, 5, 9, "white", false],
                        [2, 5, 11, "white", false], [3, 5, 11, "white", false], [4, 5, 11, "white", false], [5, 5, 11, "white", false], [6, 5, 11, "white", false], [7, 5, 11, "white", false], [8, 5, 11, "white", false], [9, 5, 11, "white", false],
                    ],
                    [
                        [0, 0, 0, "white", false], [3, 0, 0, "white", false],
                        [4, 0, 0, "white", false], [7, 0, 0, "white", false], [8, 0, 0, "white", false], [11, 0, 0, "white", false], [5, 0, 1, "white", false], [6, 0, 1, "white", false], [5, 0, 2, "white", false], [6, 0, 2, "white", false], [0, 0, 3, "white", false], [5, 0, 3, "white", false],
                        [6, 0, 3, "white", false], [11, 0, 3, "white", false], [0, 0, 4, "white", false], [5, 0, 4, "white", false], [6, 0, 4, "white", false], [11, 0, 4, "white", false], [1, 0, 5, "white", false], [2, 0, 5, "white", false], [3, 0, 5, "white", false], [4, 0, 5, "white", false],
                        [5, 0, 5, "white", false], [6, 0, 5, "white", false], [7, 0, 5, "white", false], [8, 0, 5, "white", false], [9, 0, 5, "white", false], [10, 0, 5, "white", false], [1, 0, 6, "white", false], [2, 0, 6, "white", false], [3, 0, 6, "white", false], [4, 0, 6, "white", false],
                        [5, 0, 6, "white", false], [6, 0, 6, "white", false], [7, 0, 6, "white", false], [8, 0, 6, "white", false], [9, 0, 6, "white", false], [10, 0, 6, "white", false], [0, 0, 7, "white", false], [5, 0, 7, "white", false], [6, 0, 7, "white", false], [11, 0, 7, "white", false],
                        [0, 0, 8, "white", false], [5, 0, 8, "white", false], [6, 0, 8, "white", false], [11, 0, 8, "white", false], [5, 0, 9, "white", false], [6, 0, 9, "white", false], [5, 0, 10, "white", false], [6, 0, 10, "white", false], [0, 0, 11, "white", false], [3, 0, 11, "white", false],
                        [4, 0, 11, "white", false], [7, 0, 11, "white", false], [8, 0, 11, "white", false], [11, 0, 11, "white", false], [3, 6, 0, "white", false], [8, 6, 0, "white", false], [0, 6, 3, "white", false], [11, 6, 3, "white", false], [0, 6, 8, "white", false], [11, 6, 8, "white", false],
                        [3, 6, 11, "white", false], [8, 6, 11, "white", false], [2, 7, 0, "white", false], [9, 7, 0, "white", false], [0, 7, 4, "white", false], [11, 7, 4, "white", false], [0, 7, 7, "white", false], [11, 7, 7, "white", false], [2, 7, 11, "white", false], [9, 7, 11, "white", false],
    
                    ],
                    [
                        [1, 0, 0, "white", false], [3, 0, 0, "white", false], [4, 0, 0, "white", false], [7, 0, 0, "white", false], [8, 0, 0, "white", false], [10, 0, 0, "white", false], [0, 0, 1, "white", false], [5, 0, 1, "white", false], [6, 0, 1, "white", false], [11, 0, 1, "white", false],
                        [5, 0, 2, "white", false], [6, 0, 2, "white", false], [0, 0, 3, "white", false], [5, 0, 3, "white", false], [6, 0, 3, "white", false], [11, 0, 3, "white", false], [0, 0, 4, "white", false], [5, 0, 4, "white", false], [6, 0, 4, "white", false], [11, 0, 4, "white", false],
                        [1, 0, 5, "white", false], [2, 0, 5, "white", false], [3, 0, 5, "white", false], [4, 0, 5, "white", false], [5, 0, 5, "white", false], [6, 0, 5, "white", false], [7, 0, 5, "white", false], [8, 0, 5, "white", false], [9, 0, 5, "white", false], [10, 0, 5, "white", false],
                        [1, 0, 6, "white", false], [2, 0, 6, "white", false], [3, 0, 6, "white", false], [4, 0, 6, "white", false], [5, 0, 6, "white", false], [6, 0, 6, "white", false], [7, 0, 6, "white", false], [8, 0, 6, "white", false], [9, 0, 6, "white", false], [10, 0, 6, "white", false],
                        [0, 0, 7, "white", false], [5, 0, 7, "white", false], [6, 0, 7, "white", false], [11, 0, 7, "white", false], [0, 0, 8, "white", false], [5, 0, 8, "white", false], [6, 0, 8, "white", false], [11, 0, 8, "white", false], [5, 0, 9, "white", false], [6, 0, 9, "white", false],
                        [0, 0, 10, "white", false], [5, 0, 10, "white", false], [6, 0, 10, "white", false], [11, 0, 10, "white", false], [1, 0, 11, "white", false], [3, 0, 11, "white", false], [4, 0, 11, "white", false], [7, 0, 11, "white", false], [8, 0, 11, "white", false], [10, 0, 11, "white", false],
                        [3, 6, 0, "white", false], [8, 6, 0, "white", false], [0, 6, 3, "white", false], [11, 6, 3, "white", false], [0, 6, 8, "white", false], [11, 6, 8, "white", false], [3, 6, 11, "white", false], [8, 6, 11, "white", false], [4, 7, 0, "white", false], [7, 7, 0, "white", false],
                        [0, 7, 2, "white", false], [11, 7, 2, "white", false], [0, 7, 9, "white", false], [11, 7, 9, "white", false], [4, 7, 11, "white", false], [7, 7, 11, "white", false],
                    ],

                    
                ],
            },
    
            // elias's level boss
            {
                type_id: 21,
                is_minion: false,
                has_kill_block: true,
                // flip_z: true,
                flip_y: true,
                // flip_z: true,
                // time_per_frame: [500,500],
                parts: [
    
                    [
                        [0, 0, 0, "pink", false], [1, 0, 0, "pink", false], [2, 0, 0, "pink", false], [3, 0, 0, "magenta", false], [4, 0, 0, "magenta", false], [5, 0, 0, "magenta", false], [6, 0, 0, "pink", false], [7, 0, 0, "pink", false], [8, 0, 0, "pink", false], [0, 0, 1, "pink", false],
                        [1, 0, 1, "pink", false], [2, 0, 1, "pink", false], [3, 0, 1, "magenta", false], [4, 0, 1, "magenta", false], [5, 0, 1, "pink", false], [6, 0, 1, "pink", false], [7, 0, 1, "pink", false], [8, 0, 1, "pink", false], [0, 0, 2, "pink", false], [1, 0, 2, "pink", false],
                        [2, 0, 2, "pink", false], [3, 0, 2, "pink", false], [4, 0, 2, "pink", false], [5, 0, 2, "pink", false], [6, 0, 2, "pink", false], [7, 0, 2, "pink", false], [8, 0, 2, "pink", false], [0, 0, 3, "pink", false], [1, 0, 3, "pink", false], [2, 0, 3, "pink", false],
                        [3, 0, 3, "pink", false], [4, 0, 3, "pink", false], [5, 0, 3, "pink", false], [6, 0, 3, "pink", false], [7, 0, 3, "pink", false], [8, 0, 3, "pink", false], [0, 0, 4, "pink", false], [1, 0, 4, "pink", false], [2, 0, 4, "pink", false], [3, 0, 4, "pink", false],
                        [4, 0, 4, "pink", false], [5, 0, 4, "pink", false], [6, 0, 4, "pink", false], [7, 0, 4, "pink", false], [8, 0, 4, "pink", false], [0, 0, 5, "red", false], [1, 0, 5, "magenta", false], [2, 0, 5, "pink", false], [3, 0, 5, "pink", false], [4, 0, 5, "pink", false],
                        [5, 0, 5, "pink", false], [6, 0, 5, "pink", false], [7, 0, 5, "magenta", false], [8, 0, 5, "red", false], [0, 1, 0, "pink", false], [1, 1, 0, "pink", false], [2, 1, 0, "pink", false], [3, 1, 0, "magenta", false], [4, 1, 0, "white", false], [5, 1, 0, "magenta", false],
                        [6, 1, 0, "pink", false], [7, 1, 0, "pink", false], [8, 1, 0, "pink", false], [0, 1, 1, "pink", false], [8, 1, 1, "pink", false], [0, 1, 2, "pink", false], [8, 1, 2, "pink", false], [0, 1, 3, "pink", false], [8, 1, 3, "pink", false], [0, 1, 4, "pink", false],
                        [8, 1, 4, "pink", false], [0, 1, 5, "red", false], [1, 1, 5, "red", false], [2, 1, 5, "magenta", false], [3, 1, 5, "pink", false], [4, 1, 5, "pink", false], [5, 1, 5, "pink", false], [6, 1, 5, "magenta", false], [7, 1, 5, "red", false], [8, 1, 5, "red", false],
                        [0, 2, 0, "pink", false], [1, 2, 0, "pink", false], [2, 2, 0, "magenta", false], [3, 2, 0, "white", false], [4, 2, 0, "white", false], [5, 2, 0, "white", false], [6, 2, 0, "magenta", false], [7, 2, 0, "pink", false], [8, 2, 0, "pink", false], [0, 2, 1, "pink", false],
                        [8, 2, 1, "pink", false], [0, 2, 2, "magenta", false], [3, 2, 2, "blue", true], [4, 2, 2, "blue", true], [8, 2, 2, "magenta", false], [0, 2, 3, "magenta", false], [3, 2, 3, "blue", true], [4, 2, 3, "blue", true], [8, 2, 3, "magenta", false], [0, 2, 4, "pink", false],
                        [8, 2, 4, "pink", false], [0, 2, 5, "pink", false], [1, 2, 5, "red", false], [2, 2, 5, "red", false], [3, 2, 5, "magenta", false], [4, 2, 5, "pink", false], [5, 2, 5, "magenta", false], [6, 2, 5, "red", false], [7, 2, 5, "red", false], [8, 2, 5, "pink", false],
                        [0, 3, 0, "pink", false], [1, 3, 0, "pink", false], [2, 3, 0, "pink", false], [3, 3, 0, "magenta", false], [4, 3, 0, "white", false], [5, 3, 0, "magenta", false], [6, 3, 0, "magenta", false], [7, 3, 0, "magenta", false], [8, 3, 0, "pink", false], [0, 3, 1, "magenta", false],
                        [8, 3, 1, "magenta", false], [0, 3, 2, "magenta", false], [3, 3, 2, "blue", true], [4, 3, 2, "blue", true], [8, 3, 2, "magenta", false], [0, 3, 3, "magenta", false], [3, 3, 3, "blue", true], [4, 3, 3, "blue", true], [8, 3, 3, "magenta", false], [0, 3, 4, "magenta", false],
                        [8, 3, 4, "magenta", false], [0, 3, 5, "pink", false], [1, 3, 5, "black", false], [2, 3, 5, "pink", false], [3, 3, 5, "red", false], [4, 3, 5, "magenta", false], [5, 3, 5, "red", false], [6, 3, 5, "pink", false], [7, 3, 5, "black", false], [8, 3, 5, "pink", false],
                        [0, 4, 0, "pink", false], [1, 4, 0, "pink", false], [2, 4, 0, "pink", false], [3, 4, 0, "magenta", false], [4, 4, 0, "magenta", false], [5, 4, 0, "magenta", false], [6, 4, 0, "magenta", false], [7, 4, 0, "pink", false], [8, 4, 0, "pink", false], [0, 4, 1, "pink", false],
                        [8, 4, 1, "pink", false], [0, 4, 2, "magenta", false], [8, 4, 2, "magenta", false], [0, 4, 3, "magenta", false], [3, 4, 3, "blue", true], [4, 4, 3, "blue", true], [8, 4, 3, "magenta", false], [0, 4, 4, "pink", false], [8, 4, 4, "pink", false], [0, 4, 5, "pink", false],
                        [1, 4, 5, "black", false], [2, 4, 5, "pink", false], [3, 4, 5, "red", false], [4, 4, 5, "red", false], [5, 4, 5, "red", false], [6, 4, 5, "pink", false], [7, 4, 5, "black", false], [8, 4, 5, "pink", false], [0, 5, 0, "pink", false], [1, 5, 0, "pink", false],
                        [2, 5, 0, "pink", false], [3, 5, 0, "pink", false], [4, 5, 0, "pink", false], [5, 5, 0, "pink", false], [6, 5, 0, "pink", false], [7, 5, 0, "pink", false], [8, 5, 0, "pink", false], [0, 5, 1, "pink", false], [8, 5, 1, "pink", false], [0, 5, 2, "pink", false],
                        [8, 5, 2, "pink", false], [0, 5, 3, "pink", false], [8, 5, 3, "pink", false], [0, 5, 4, "pink", false], [8, 5, 4, "pink", false], [0, 5, 5, "pink", false], [1, 5, 5, "pink", false], [2, 5, 5, "pink", false], [3, 5, 5, "pink", false], [4, 5, 5, "red", false],
                        [5, 5, 5, "pink", false], [6, 5, 5, "pink", false], [7, 5, 5, "pink", false], [8, 5, 5, "pink", false], [4, 6, 0, "pink", false], [6, 6, 0, "pink", false], [2, 6, 1, "pink", false], [1, 6, 2, "pink", false], [4, 6, 2, "magenta", false], [7, 6, 2, "pink", false],
                        [3, 6, 3, "pink", false], [6, 6, 4, "pink", false], [0, 6, 5, "pink", false], [2, 6, 5, "magenta", false], [4, 6, 5, "pink", false], [6, 6, 5, "pink", false], [8, 6, 5, "magenta", false], [4, 7, 0, "pink", false], [6, 7, 0, "magenta", false], [1, 7, 2, "pink", false],
                        [4, 7, 2, "pink", false], [7, 7, 2, "pink", false], [3, 7, 3, "pink", false], [6, 7, 4, "magenta", false], [0, 7, 5, "pink", false], [4, 7, 5, "pink", false], [8, 7, 5, "pink", false], [4, 8, 0, "magenta", false], [1, 8, 2, "magenta", false], [6, 8, 4, "magenta", false],
                        [4, 8, 5, "magenta", false], [4, 9, 0, "pink", false],
                    ],
        
                ],
            },
            
            // missile
            {
                type_id: 40,
                is_minion: false,
                has_kill_block: false,
                time_per_frame: [100,100],
                parts: [
                        [
                            [1, 1, 0, "red"], [2, 1, 0, "red"], [1, 1, 1, "white"], [2, 1, 1, "white"], [1, 1, 2, "white"], [2, 1, 2, "white"], [1, 1, 3, "white"], [2, 1, 3, "white"], [1, 1, 4, "white"], [2, 1, 4, "white"],
                            [1, 1, 5, "white"], [2, 1, 5, "white"], [1, 1, 6, "white"], [2, 1, 6, "white"], [1, 2, 0, "red"], [2, 2, 0, "red"], [1, 2, 1, "white"], [2, 2, 1, "white"], [1, 2, 2, "white"], [2, 2, 2, "white"],
                            [1, 2, 3, "white"], [2, 2, 3, "white"], [1, 2, 4, "white"], [2, 2, 4, "white"], [1, 2, 5, "white"], [2, 2, 5, "white"], [1, 2, 6, "white"], [2, 2, 6, "white"],
                        ],
                        [
                            [1, 0, 5, "silver"], [1, 0, 6, "silver"],
                            [3, 1, 5, "silver"], [3, 1, 6, "silver"], [0, 2, 5, "silver"], [0, 2, 6, "silver"], [2, 3, 5, "silver"], [2, 3, 6, "silver"],
                        ],
                        [
                            [2, 0, 5, "silver"], [2, 0, 6, "silver"], [0, 1, 5, "silver"], [0, 1, 6, "silver"],
                            [3, 2, 5, "silver"], [3, 2, 6, "silver"], [1, 3, 5, "silver"], [1, 3, 6, "silver"],
                        ],
                    ]
            }
            
        ];
    }
    
    
    class Player {
    
        static camera;
        static listener;
        
        // group of things that should move with the player
        static group;

        static radius = 0.75;
        
        static init() {
    
            Player.camera = new THREE.PerspectiveCamera(
                55, // fov
                window.innerWidth / window.innerHeight,
                0.1, // near
                Game.config.fov_far // far
            );
            Player.camera.aspect = window.innerWidth / window.innerHeight;
            Player.camera.name = "camera";
            Player.group = new THREE.Group();
            Player.group.name = "player_group";
            Player.group.add(Player.camera);
            Game.scene.add(Player.group);
    
            // watch from afar
            // Player.group.position.z -= 4;
            // Player.group.position.y += 5;
            
            Player.listener = new THREE.AudioListener();
            Player.camera.add( Player.listener );
            
            
            Blaster.equip_blaster("right", "B");
            Blaster.equip_blaster("left", "B");
    
            ScoreWatch.create();
    
            Controls.add_event_listener(
                "onRightButtonAPressed",
                function(event) {
                    Player.switch_blaster(event, "right");
                },
                Player.switch_blaster,
            );
            Controls.add_event_listener(
                "onLeftButtonAPressed",
                function(event) {
                    Player.switch_blaster(event, "right");
                },
            );
            Controls.add_event_listener(
                "onRightButtonBPressed",
                function(event) {
                    Player.switch_blaster(event, "left");
                },
                Player.switch_blaster,
            );
            Controls.add_event_listener(
                "onLeftButtonBPressed",
                function(event) {
                    Player.switch_blaster(event, "left");
                },
            );
            
        }
        
        static switch_blaster(event, direction) {
            let handedness = event.controller.userData.handedness;

            let new_blaster_iden;
            let blaster;
            if (handedness === "right") {
                blaster = Blaster.equipped_right_blaster;
            }
            else {
                blaster = Blaster.equipped_left_blaster;
            }

            let blaster_idens = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N'];
            if (blaster === null) {
                new_blaster_iden = "A";
            }
            else if (direction === "right") {
                if (blaster.userData.blaster_config.iden === "N") {
                    new_blaster_iden = "A";
                }
                else {
                    let index = blaster_idens.indexOf(blaster.userData.blaster_config.iden);
                    new_blaster_iden = blaster_idens[index + 1];
                }
            }
            else if (direction === "left") {
                if (blaster.userData.blaster_config.iden === "A") {
                    new_blaster_iden = "N";
                }
                else {
                    let index = blaster_idens.indexOf(blaster.userData.blaster_config.iden);
                    new_blaster_iden = blaster_idens[index - 1];
                }
            }
    
            Blaster.equip_blaster(handedness, new_blaster_iden);
        }
        
        
    }
    
    class ScoreWatch extends THREE.Group {
    
        static create() {
        
            let controller = Controls.get_xr_controller("left");
            if (!controller) {
                setTimeout(
                    function() {
                        ScoreWatch.create()
                    },
                    100,
                );
                return;
            }
        
            return new ScoreWatch(controller);
        }
        
        static watch;
        static ctx;

        constructor(controller) {
            super();

            ScoreWatch.ctx = document.createElement('canvas').getContext('2d');
            let ctx = ScoreWatch.ctx;
            ctx.canvas.width = 256;
            ctx.canvas.height = 256;
            const texture = new THREE.CanvasTexture(ctx.canvas);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
            });
    
            const size = 0.03;
            const geometry = new THREE.CylinderGeometry(size, size, 0.01, 32 );
    
            ScoreWatch.watch = new THREE.Mesh( geometry, material );
            ScoreWatch.watch.position.z += 0.25;
    
            ScoreWatch.watch.position.x += 0.025;

            ScoreWatch.watch.rotateY(Math.PI);
            ScoreWatch.watch.rotateZ(Math.PI / 2);
    
            const ring_geometry = new THREE.RingGeometry( size, size - .002, 32 );
            const ring_material = new THREE.MeshBasicMaterial( { color: "#FF0000", side: THREE.DoubleSide} );
            const watch_ring = new THREE.Mesh( ring_geometry, ring_material );
            watch_ring.rotateY(Math.PI / 2);
            watch_ring.position.x += 0.031;
            watch_ring.position.z += 0.25;
    
            this.add(watch_ring);
            this.add( ScoreWatch.watch );
    
            controller.add(this);
    
            watch_ring.updateMatrix();
            
            ScoreWatch.draw();

        }
        
        static draw() {
            
            let timer = Math.ceil(Level.timer);
            let ctx = ScoreWatch.ctx;
            
            if (typeof ScoreWatch.ctx === "undefined") {
                // not yet initialized
                return;
            }

            const context = ctx.canvas.getContext('2d');
            context.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
            ctx.textAlign = "center";
    
            ctx.fillStyle = '#EEEEEE';
            ctx.font = "30px Arial";
            ctx.fillText("Kills", ctx.canvas.width/2, (ctx.canvas.height/2) - 70);
            ctx.font = "70px Arial";
            ctx.fillText(Game.kills, ctx.canvas.width/2, (ctx.canvas.height/2) - 10);
    
            ctx.fillStyle = '#777777';
            ctx.font = "55px Arial";
            ctx.fillText(timer, ctx.canvas.width/2, (ctx.canvas.height/2) + 55);
            ctx.font = "30px Arial";
            ctx.fillText("Level " + Level.current_level, ctx.canvas.width/2, (ctx.canvas.height/2) + 90);

            ScoreWatch.watch.material.map.needsUpdate = true;
        }
    
    }
    
    class World {

        static init() {
    
            World.add_sky();

            World.add_platform();

            // Sounds.play("wind");
    
            Game.scene.add( new THREE.AmbientLight( 0xFFFFFF ) );
            
        }
    
        static platform_floor;
        static platform_ring;
        
        static add_platform() {
            
            let size = 0.7;
            const metal_floor_texture = new THREE.TextureLoader().load( 'assets/grate.png' );
            metal_floor_texture.wrapS = THREE.RepeatWrapping;  // horizontal
            metal_floor_texture.wrapT = THREE.RepeatWrapping; // vertical
            metal_floor_texture.repeat.set(8,8);
            const metal_floor_material = new THREE.MeshBasicMaterial({
                map: metal_floor_texture,
                transparent: true,
            });
            const metal_floor_geometry = new THREE.CylinderGeometry(size, size, 0.01, 32 );
            let platform_floor = new THREE.Mesh( metal_floor_geometry, metal_floor_material );
            platform_floor.position.set(0, -1.6, 0);
            platform_floor.name = "platform";
            Game.scene.add(platform_floor);
    
    
            const ring_texture = new THREE.TextureLoader().load( 'assets/metal_bar.png' );
            ring_texture.wrapS = THREE.RepeatWrapping;  // horizontal
            ring_texture.wrapT = THREE.RepeatWrapping; // vertical
            ring_texture.repeat.set(10,10);

            const ring_material = new THREE.MeshBasicMaterial({
                map: ring_texture,
            });
    
            const ring_geometry = new THREE.RingGeometry( size, size * 0.9 , 64 );
            const platform_ring = new THREE.Mesh( ring_geometry, ring_material );
            platform_ring.name = "platform";
            platform_ring.position.set(0, -1.59, 0);
            platform_ring.rotateX(Math.PI / 2);
            Game.scene.add(platform_ring);
    
            World.platform_floor = platform_floor;
            World.platform_ring = platform_ring;
        }
        
        
        static add_sky() {
    
            let materialArray = [];

            let texture_ft = new THREE.TextureLoader().load( 'assets/world/bkg3_right1.png');
            let texture_bk = new THREE.TextureLoader().load( 'assets/world/bkg3_left2.png');
            let texture_up = new THREE.TextureLoader().load( 'assets/world/bkg3_top3.png');
            let texture_dn = new THREE.TextureLoader().load( 'assets/world/bkg3_bottom4.png');
            let texture_rt = new THREE.TextureLoader().load( 'assets/world/bkg3_front5.png');
            let texture_lf = new THREE.TextureLoader().load( 'assets/world/bkg3_back6.png');
            materialArray.push(new THREE.MeshBasicMaterial( { map: texture_ft }));
            materialArray.push(new THREE.MeshBasicMaterial( { map: texture_bk }));
            materialArray.push(new THREE.MeshBasicMaterial( { map: texture_up }));
            materialArray.push(new THREE.MeshBasicMaterial( { map: texture_dn }));
            materialArray.push(new THREE.MeshBasicMaterial( { map: texture_rt }));
            materialArray.push(new THREE.MeshBasicMaterial( { map: texture_lf }));
    
            for (let i = 0; i < 6; i++)
                materialArray[i].side = THREE.BackSide;
    
            let skyboxGeo = new THREE.BoxGeometry( Game.config.fov_far - 100,  Game.config.fov_far - 100,  Game.config.fov_far - 100);
            let skybox = new THREE.Mesh( skyboxGeo, materialArray );
            Game.scene.add( skybox );
            
            
            // earth http://planetpixelemporium.com/earth8081.html
            const ground_geometry = new THREE.SphereGeometry( 3000, 64, 16 );
            let earth_texture = new THREE.TextureLoader().load( 'assets/world/earth10k.jpg');
            const ground_material = new THREE.MeshBasicMaterial( { map: earth_texture } );
            const ground = new THREE.Mesh( ground_geometry, ground_material );
            ground.position.set(0, -4000 , 0);
            Game.scene.add( ground );
            

            // rotate the world real slow
            setInterval(function() {
                ground.rotateX(Math.PI / 100000);
                skybox.rotateZ(Math.PI / 200000);
            },
                10
            );
            
        }
    
        static draw_point(x, y, z, color) {
            if (!color) {
                color = "#FF0000";
            }
            const geometry = new THREE.BoxGeometry(0.05, 0.05, 0.05);
            const material = new THREE.MeshBasicMaterial( { color: color } );
            const cube = new THREE.Mesh( geometry, material );
            Game.scene.add( cube );
            cube.position.set(x, y, z);
            return cube;
        }
    
    
    }
    
    class Controls {
    
        static xr_right_controller = null;
        static xr_right_grip = null;
        static xr_left_controller = null;
        static xr_left_grip = null;
    
        static xr_controller_button_mapping = {
            squeeze: 1,
            trigger: 0,
            a: 4,
            b: 5,
        }
    
        static raycaster_distance = 15;
    
        static init() {
        
            if (!Game.config.on_vr_headset) {
                Controls.xr_controller_button_mapping = {
                    squeeze: 0,
                    trigger: 3,
                };
            }
    
            Controls.init_xr_controllers();
    
        }
    
        static event_listeners = {};
        
        static add_event_listener(event_name, callback) {
            if (typeof Controls.event_listeners[event_name] === "undefined") {
                Controls.event_listeners[event_name] = [];
            }
            Controls.event_listeners[event_name].push(callback);
        }

        static fire_event(event_name, event) {
            // Game.log("firing event: " + event_name);
            if (typeof Controls.event_listeners[event_name] !== "undefined") {
                for (let i = 0; i < Controls.event_listeners[event_name].length; i++) {
                    Controls.event_listeners[event_name][i](event);
                }
            }
        }
        
        static init_xr_controllers() {
            Controls.init_xr_right_controller();
            Controls.init_xr_right_controller_grip();
            Controls.init_xr_left_controller();
            Controls.init_xr_left_controller_grip();
        }
    
        static init_xr_right_controller() {
            Controls.xr_right_controller = Controls.get_xr_controller("right");
            if (!Controls.xr_right_controller) {
                setTimeout(Controls.init_xr_right_controller, 100);
                return;
            }
        
            Player.group.add(Controls.xr_right_controller);
    
            Controls.xr_right_controller.userData = {};
            Controls.xr_right_controller.userData.handedness = "right";

            // let raycaster = new THREE.Raycaster();
            // let arrow = new THREE.ArrowHelper(raycaster.ray.direction, raycaster.ray.origin, Controls.raycaster_distance, 0xff0000, 0, 0);
            // arrow.visible = true;
            // Controls.xr_right_controller.add(arrow);
            // Controls.xr_right_controller.userData.raycaster = raycaster;
            // Controls.xr_right_controller.userData.arrow = arrow;
        }
    
        static init_xr_right_controller_grip() {
            Controls.xr_right_grip = Controls.get_xr_controller_grip("right");
            if (!Controls.xr_right_grip) {
                setTimeout(Controls.init_xr_right_controller_grip, 100);
                return;
            }
            let controllerModelFactory = new XRControllerModelFactory();
            Controls.xr_right_grip.add(
                controllerModelFactory.createControllerModel(Controls.xr_right_grip)
            );
            Player.group.add(Controls.xr_right_grip);
        }
    
        static init_xr_left_controller() {
            Controls.xr_left_controller = Controls.get_xr_controller("left");
            if (!Controls.xr_left_controller) {
                setTimeout(Controls.init_xr_left_controller, 100);
                return;
            }
            Player.group.add(Controls.xr_left_controller);
    
            Controls.xr_left_controller.userData = {};
            Controls.xr_left_controller.userData.handedness = "left";
    
            // let raycaster = new THREE.Raycaster();
            // let arrow = new THREE.ArrowHelper(raycaster.ray.direction, raycaster.ray.origin, Controls.raycaster_distance, 0xff0000, 0, 0);
            // arrow.visible = false;
            // Controls.xr_left_controller.add(arrow);
            // Controls.xr_left_controller.userData.raycaster = raycaster;
            // Controls.xr_left_controller.userData.arrow = arrow;
        }
    
        static init_xr_left_controller_grip() {
            Controls.xr_left_grip = Controls.get_xr_controller_grip("left");
            if (!Controls.xr_left_grip) {
                setTimeout(Controls.init_xr_left_controller_grip, 100);
                return;
            }
            let controllerModelFactory = new XRControllerModelFactory();
            Controls.xr_left_grip.add(
                controllerModelFactory.createControllerModel(Controls.xr_left_grip)
            );
            Player.group.add(Controls.xr_left_grip);
        }
    
        static get_xr_controller(handedness) {
            return Controls.get_xr_controller_resource(handedness);
        }
    
        static get_xr_controller_grip(handedness) {
            return Controls.get_xr_controller_resource(handedness, "grip");
        }
    
        static get_xr_controller_resource(handedness, resource) {
            if (resource !== "controller" && resource !== "grip") {
                resource = "controller";
            }
    
            let inputSources = Controls.get_xr_input_sources();
            if (!inputSources) {
                return null;
            }
        
            let controller_num = 0;
            for (const source of inputSources) {
                if (!source) {
                    continue;
                }
                if (!source.gamepad) {
                    continue;
                }
                if (
                    !source.handedness
                    || (
                        source.handedness !== "right"
                        && source.handedness !== "left"
                    )
                ) {
                    continue;
                }
            
                if (source.handedness === handedness) {
                    if (resource === "controller") {
                        return Game.renderer.xr.getController(controller_num);
                    } else if (resource === "grip") {
                        return Game.renderer.xr.getControllerGrip(controller_num);
                    }
                }
                controller_num++;
            }
            return null;
        }
    
        static get_xr_input_sources() {
            const session = Game.renderer.xr.getSession();
            if (session) {
                if (session.inputSources !== null && typeof session.inputSources[Symbol.iterator] === "function") {
                    return session.inputSources;
                }
            }
            return null;
        }
    
        static poll() {
            Controls.fire_xr_controller_events();
        }
    
        // https://stackoverflow.com/questions/62476426/webxr-controllers-for-button-pressing-in-three-js
        static fire_xr_controller_events() {
        
            if (!Game.renderer.xr.isPresenting) {
                return;
            }

            if (typeof Controls.fire_xr_controller_events.prev_controller_states === "undefined") {
                Controls.fire_xr_controller_events.prev_controller_states = new Map();
            }
        
            let inputSources = Controls.get_xr_input_sources();
            if (!inputSources) {
                return;
            }
        
            let controller_num = 0;
            for (const source of inputSources) {
                if (!source) {
                    continue;
                }
                if (!source.gamepad) {
                    continue;
                }
                if (
                    !source.handedness
                    || (
                        source.handedness !== "right"
                        && source.handedness !== "left"
                    )
                ) {
                    continue;
                }
    
                let controller = Game.renderer.xr.getController(controller_num);
                let handedness = source.handedness;
                let controller_buttons = source.gamepad.buttons.map((b) => b.value);
                let controller_sticks = source.gamepad.axes.slice(0);
                let prev_controller_state = Controls.fire_xr_controller_events.prev_controller_states.get(source);
                if (prev_controller_state) {
                
                    // handlers for buttons
                    controller_buttons.forEach((value, button_num) => {
                        let current_value = Math.round(value);
                        let previous_value = Math.round(prev_controller_state.buttons[button_num]);
                    
                        if (current_value !== previous_value) {
                        
                            // button down
                            if (current_value) {
                                // trigger button
                                if (button_num === Controls.xr_controller_button_mapping.trigger) {
                                    if (handedness === "right") {
                                        Controls.fire_event("onRightTriggerPressed", {controller: controller});
                                    } else if (handedness === "left") {
                                        Controls.fire_event("onLeftTriggerPressed", {controller: controller});
                                    }
                                }
                                // squeeze button
                                else if (button_num === Controls.xr_controller_button_mapping.squeeze) {
                                    if (handedness === "right") {
                                        Controls.fire_event("onRightSqueezePressed", {controller: controller});
                                    } else if (handedness === "left") {
                                        Controls.fire_event("onLeftSqueezePressed", {controller: controller});
                                    }
                                }
                                // a button
                                else if (button_num === Controls.xr_controller_button_mapping.a) {
                                    if (handedness === "right") {
                                        Controls.fire_event("onRightButtonAPressed", {controller: controller});
                                    } else if (handedness === "left") {
                                        Controls.fire_event("onLeftButtonAPressed", {controller: controller});
                                    }
                                }
                                // b button
                                else if (button_num === Controls.xr_controller_button_mapping.b) {
                                    if (handedness === "right") {
                                        Controls.fire_event("onRightButtonBPressed", {controller: controller});
                                    } else if (handedness === "left") {
                                        Controls.fire_event("onLeftButtonBPressed", {controller: controller});
                                    }
                                } else {
                                    Game.log("Unknown " + handedness + " button " + button_num + " pressed");
                                    Sounds.play('error');
                                    // for (var z = 0; z < button_num; z++) {
                                    //     setTimeout(
                                    //         function() {
                                    //             Sounds.play("click");
                                    //         },
                                    //         z * 500
                                    //     );
                                    // }
                                }
                            
                            }
                        
                            // button up
                            else {
                            
                                if (button_num === Controls.xr_controller_button_mapping.trigger) {
                                    if (handedness === "right") {
                                        Controls.fire_event("onRightTriggerReleased", {controller: controller});
                                    } else if (handedness === "left") {
                                        Controls.fire_event("onLeftTriggerReleased", {controller: controller});
                                    }
                                }
                                // squeeze button
                                else if (button_num === Controls.xr_controller_button_mapping.squeeze) {
                                    if (handedness === "right") {
                                        Controls.fire_event("onRightSqueezeReleased", {controller: controller});
                                    } else if (handedness === "left") {
                                        Controls.fire_event("onLeftSqueezeReleased", {controller: controller});
                                    }
                                }
                                // a button
                                else if (button_num === Controls.xr_controller_button_mapping.a) {
                                    if (handedness === "right") {
                                        Controls.fire_event("onRightButtonAReleased", {controller: controller});
                                    } else if (handedness === "left") {
                                        Controls.fire_event("onLeftButtonAReleased", {controller: controller});
                                    }
                                }
                                // b button
                                else if (button_num === Controls.xr_controller_button_mapping.b) {
                                    if (handedness === "right") {
                                        Controls.fire_event("onRightButtonBReleased", {controller: controller});
                                    } else if (handedness === "left") {
                                        Controls.fire_event("onLeftButtonBReleased", {controller: controller});
                                    }
                                } else {
                                    Game.log("Unknown " + handedness + " button " + button_num + " released");
                                }
                            
                            }
                        }
                    });
                
                
                    // handlers for thumb joy sticks
                
                    // we only consider stick moved if it has moved beyond the minimum threshold from center,
                    // bc these seem to wander up to about .17 with no input
                    const min_value_threshold = 0.2;
                
                    let previous_stick_state = {
                        x: 0, // right/left
                        y: 0, // up/down
                    };
                
                    prev_controller_state.axis.forEach((value, i) => {
                        if (Math.abs(value) <= min_value_threshold) {
                            value = 0.0;
                        }
                        // left/right
                        if (i === 2) {
                            previous_stick_state.x = value;
                        }
                        // up/down
                        if (i === 3) {
                            previous_stick_state.y = value;
                        }
                    });
                
                    let current_stick_state = {
                        x: 0, // right/left
                        y: 0, // up/down
                    };
                
                    controller_sticks.forEach((value, i) => {
                        if (Math.abs(value) <= min_value_threshold) {
                            value = 0.0;
                        }
                        // left/right
                        if (i === 2) {
                            current_stick_state.x = value;
                        }
                        // up/down
                        if (i === 3) {
                            current_stick_state.y = value;
                        }
                    });
                
                    if (
                        previous_stick_state.x !== current_stick_state.x
                        || previous_stick_state.y !== current_stick_state.y
                    ) {
                        if (handedness === "right") {
                            Controls.fire_event("onRightStickChanged", {value: current_stick_state});
                        } else {
                            Controls.fire_event("onLeftStickChanged", {value: current_stick_state});
                        }
                    }
    
                    // TODO: only fire this if the controller actually moved maybe?
                    Controls.fire_event("onControllerMove", {controller: controller});
                    
                    controller_num++;
                }
            
                Controls.fire_xr_controller_events.prev_controller_states.set(source, {
                    buttons: controller_buttons,
                    axis: controller_sticks
                });
            }
        }
    
    }
    
    class Sounds {
    
        static listener;
        
        static sounds;

        static init() {
    
            if (typeof Player.listener === "undefined") {
                setTimeout(
                    function() {
                        Sounds.init();
                    },
                    100
                );
                return;
            }
            
            let sounds = {
                "wind": {
                    url: 'assets/wind.wav',
                    loop: true,
                    volume: 0.5,
                },
                "blaster_shot": {
                    url: 'assets/blaster-shot.wav',
                },
                "blaster_equipped": {
                    url: 'assets/blaster_equipped.ogg?v=3',
                },
                "missile_launch": {
                    url: 'assets/missile-launch.ogg',
                },
                "missile_alert": {
                    url: 'assets/missile-alert.ogg',
                },
                "explosion": {
                    url: 'assets/explosion.ogg',
                },
                "enemy_hit": {
                    url: 'assets/enemy-hit.ogg?v=2',
                    volume: 0.6,
                },
                "teleport_in": {
                    url: 'assets/teleport-in.ogg',
                },
                "teleport_out": {
                    url: 'assets/teleport-out.ogg',
                },
                "level1": {
                    url: 'assets/level1.ogg',
                    volume: 0.9,
                },
                "level2": {
                    url: 'assets/level2.ogg',
                    volume: 0.9,
                },
                "level3": {
                    url: 'assets/level3.ogg',
                    volume: 0.9,
                },
                "level4": {
                    url: 'assets/level4.ogg',
                    volume: 0.9,
                },
                "level5": {
                    url: 'assets/level5.ogg',
                    volume: 0.9,
                },
                "level6": {
                    url: 'assets/level6.ogg',
                    volume: 0.9,
                },
                "level7": {
                    url: 'assets/level7.ogg',
                    volume: 0.9,
                },
                "level8": {
                    url: 'assets/level8.ogg',
                    volume: 0.9,
                },
                "level9": {
                    url: 'assets/level9.ogg',
                    volume: 0.9,
                },
                "level10": {
                    url: 'assets/level10.ogg',
                    volume: 0.9,
                },
                "level11": {
                    url: 'assets/level11.ogg',
                    volume: 0.9,
                },
                "level12": {
                    url: 'assets/level12.ogg',
                    volume: 0.9,
                },
                "level13": {
                    url: 'assets/level13.ogg',
                    volume: 0.9,
                },
                "level14": {
                    url: 'assets/level14.ogg',
                    volume: 0.9,
                },
                "level15": {
                    url: 'assets/level15.ogg',
                    volume: 0.9,
                },
                "level16": {
                    url: 'assets/level16.ogg',
                    volume: 0.9,
                },
                "level17": {
                    url: 'assets/level17.ogg',
                    volume: 0.9,
                },
                "level18": {
                    url: 'assets/level18.ogg',
                    volume: 0.9,
                },
                "level19": {
                    url: 'assets/level19.ogg',
                    volume: 0.9,
                },
                "level20": {
                    url: 'assets/level20.ogg',
                    volume: 0.9,
                },
                "levels_complete": {
                    url: 'assets/levels-complete.ogg',
                    volume: 0.9,
                },
                "next_level": {
                    url: 'assets/next-level.ogg',
                    volume: 0.9,
                },
                "game_over": {
                    url: 'assets/game-over.ogg',
                    volume: 0.9,
                },
                "metal_ping1": {
                    url: 'assets/metal-ping1.ogg',
                },
                "metal_ping2": {
                    url: 'assets/metal-ping2.ogg',
                },
                "metal_ping3": {
                    url: 'assets/metal-ping3.ogg',
                },
            };
            Sounds.sounds = {};
            for (const sound_name in sounds) {
                let sound_info = sounds[sound_name];
                Sounds.sounds[sound_name] = {
                    ready: false,
                    audio: new THREE.PositionalAudio( Player.listener ),
                };
                const audioLoader = new THREE.AudioLoader();
                audioLoader.load(
                    sound_info.url,
                    (function(sound_name, sound_info) {
                        return function (buffer) {
                            let volume = 1;
                            if (typeof sound_info.volume !== "undefined") {
                                volume = sound_info.volume;
                            }
                            Sounds.sounds[sound_name].audio.setBuffer( buffer );
                            Sounds.sounds[sound_name].audio.setLoop( sound_info.loop === true );
                            Sounds.sounds[sound_name].audio.setVolume( volume );
                            Sounds.sounds[sound_name].container = new THREE.Object3D();
                            Sounds.sounds[sound_name].container.add(Sounds.sounds[sound_name].audio);
                            Sounds.sounds[sound_name].ready = true;
                        };
                    })(sound_name, sound_info)
                );
            }
        }

        static play(identifier, position) {
            
            if (!Game.config.sound) {
                return;
            }
            if (
                typeof Sounds.sounds === "undefined"
                || (
                    typeof Sounds.sounds[identifier] !== "undefined"
                    && Sounds.sounds[identifier].ready === false
                )
            ) {
                setTimeout(
                    function() {
                        Sounds.play(identifier, position);
                    }, 100
                );
                return;
            }

            if (typeof Sounds.sounds[identifier] === "undefined") {
                Game.log("sound does not exist: " + identifier);
                return;
            }

            if (Sounds.sounds[identifier].audio.isPlaying) {
                Sounds.sounds[identifier].audio.stop();
            }
            
            if (typeof position === "undefined") {
                Sounds.sounds[identifier].container.position.copy(Player.group.position);
            }
            else {
                Sounds.sounds[identifier].container.position.copy(position);
            }
    
            Sounds.sounds[identifier].audio.play();
        }

    }
    
    class Headset {
        
        static get_world_horizontal_rotation_angle() {
            let direction = Headset.get_world_direction();
            return (Math.atan2(direction.x, direction.z)) + Math.PI;
        }
        
        static _local_position = new THREE.Vector3();
        static get_local_position() {
            if (!Game.renderer.xr.isPresenting) {
                // Player.camera.position is local pos when not in xr session
                return Player.camera.position;
            }
            
            // during xr session, Player.camera.position contains the world position
            // To get local, we convert Player.camera.position
            Headset._local_position.copy(Player.camera.position);
            Player.group.updateWorldMatrix();
            Player.group.worldToLocal(Headset._local_position);
            return Headset._local_position;
        }
        
        static _world_position = new THREE.Vector3();
        static get_world_position() {
    
            // during xr session, Player.camera.position contains the world position
            if (Game.renderer.xr.isPresenting) {
                return Player.camera.position;
            }
            
            // outside of xr session, Player.camera.position contains the local position
            // To get world, we convert from Player.camera.position
            Headset._world_position.copy(Player.camera.position)
            Player.group.updateWorldMatrix();
            Player.group.localToWorld(Headset._world_position);
            return Headset._world_position;
        }
        
        static get_local_rotation() {
            
            if (typeof Headset.get_local_rotation.init === "undefined") {
                Headset.get_local_rotation.init = true;
                Headset.get_local_rotation.camera_group_diff_quaternion = new THREE.Quaternion();
                Headset.get_local_rotation.player_group_quaternion = new THREE.Quaternion();
                Headset.get_local_rotation.local_rotation = new THREE.Euler();
            }
            let camera_group_diff_quaternion = Headset.get_local_position.camera_group_diff_quaternion;
            let player_group_quaternion = Headset.get_local_position.player_group_quaternion;
            let local_rotation = Headset.get_local_position.local_rotation;
            
            Player.group.getWorldQuaternion(player_group_quaternion);
            player_group_quaternion.invert();
            camera_group_diff_quaternion.multiplyQuaternions(Player.camera.quaternion, player_group_quaternion);
            local_rotation.setFromQuaternion(camera_group_diff_quaternion);
            return {
                x: local_rotation.x,
                y: local_rotation.y,
                z: local_rotation.z,
            };
        }
        
        static get_world_rotation() {
            if (Game.renderer.xr.isPresenting) {
                return Player.camera.rotation;
            }
            else {
                return Player.group.rotation;
            }
        }
        
        static _world_direction = new THREE.Vector3();
        static get_world_direction() {
            if (Game.renderer.xr.isPresenting) {
                Game.renderer.xr.getCamera(Player.camera).getWorldDirection(Headset._world_direction);
                return Headset._world_direction
            }
            else {
                Player.camera.getWorldDirection(Headset._world_direction);
                return Headset._world_direction
            }
        }
        
    }
    
    class Utils {
    
        // max and min are inclusive
        static get_random_number(min, max) {
            min = Math.round(min);
            max = Math.round(max);
            max++;
            return Math.floor(Math.random() * (max - min) + min);
        }
        
        static get_xyz_string(p, decimal_places = 2) {
            let x, y, z;
            if (Array.isArray(p)) {
                x = p[0];
                y = p[1];
                z = p[2];
            }
            else {
                x = p.x;
                y = p.y;
                z = p.z;
            }
            if (decimal_places !== null) {
                let r = Math.pow(10, decimal_places);
                x = Math.round(x * r) / r;
                y = Math.round(y * r) / r;
                z = Math.round(z * r) / r;
            }
            return "" + x + ", " + y + ", " + z;
        }
    
    }
    
    Game.run(options);
    
})($);



