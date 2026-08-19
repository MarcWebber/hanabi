r"""Build the single hero environment used by the fireworks experience.

Run with Blender (not regular Python):

  blender -b --python scripts/build_hero_assets.py -- \
    --kit /path/to/Medieval\ Village\ MegaKit[Standard]/glTF \
    --output public/models/hero-world.glb

The generated GLB deliberately contains the authored PBR geometry. The runtime
only owns sky, water, atmosphere and reactive light; it no longer fabricates a
city out of boxes and cylinders.
"""

from __future__ import annotations

import argparse
import math
import re
import sys
from pathlib import Path
from typing import Iterable

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector


WALL_HEIGHT = 3.123
MODULE_WIDTH = 2.0
KIT_DEFAULT = Path(
    "/private/tmp/medieval-megakit/Medieval Village MegaKit[Standard]/glTF"
)
ROCKETBOX_DEFAULT = Path(
    "/private/tmp/microsoft-rocketbox/Assets/Avatars/Adults/Female_Party_02"
)
ROCKETBOX_POSE_DEFAULT = Path(
    "/private/tmp/microsoft-rocketbox/Assets/Animations/"
    "all_animations_max_motextr_static/f_sit_chair_breathe_01.max.fbx"
)


def parse_args() -> argparse.Namespace:
    extra = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--kit", type=Path, default=KIT_DEFAULT)
    parser.add_argument(
        "--companion",
        type=Path,
        default=ROCKETBOX_DEFAULT / "Export/Female_Party_02_facial.fbx",
    )
    parser.add_argument(
        "--companion-textures",
        type=Path,
        default=ROCKETBOX_DEFAULT / "Textures",
    )
    parser.add_argument("--companion-pose", type=Path, default=ROCKETBOX_POSE_DEFAULT)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--preview", type=Path)
    return parser.parse_args(extra)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)


def move_to_collection(obj: bpy.types.Object, collection: bpy.types.Collection) -> None:
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def strip_blender_suffix(name: str) -> str:
    return re.sub(r"\.\d{3}$", "", name)


class ModuleLibrary:
    def __init__(
        self,
        source: Path,
        template_collection: bpy.types.Collection,
        output_collection: bpy.types.Collection,
    ) -> None:
        self.source = source
        self.template_collection = template_collection
        self.output_collection = output_collection
        self.templates: dict[str, list[bpy.types.Object]] = {}
        self.materials: dict[str, bpy.types.Material] = {}
        self.instance_counter = 0

    def load(self, name: str) -> list[bpy.types.Object]:
        if name in self.templates:
            return self.templates[name]
        path = self.source / f"{name}.gltf"
        if not path.exists():
            raise FileNotFoundError(path)
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(path))
        imported = [obj for obj in bpy.data.objects if obj not in before]
        meshes: list[bpy.types.Object] = []
        for obj in imported:
            if obj.type != "MESH":
                continue
            world = obj.matrix_world.copy()
            obj.parent = None
            obj.matrix_world = world
            obj.name = f"TEMPLATE_{name}_{len(meshes):02d}"
            self._canonicalize_materials(obj)
            move_to_collection(obj, self.template_collection)
            obj.hide_render = True
            obj.hide_viewport = True
            obj.select_set(False)
            meshes.append(obj)
        for obj in imported:
            if obj.type != "MESH":
                bpy.data.objects.remove(obj, do_unlink=True)
        if not meshes:
            raise RuntimeError(f"No mesh found in {path}")
        self.templates[name] = meshes
        return meshes

    def _canonicalize_materials(self, obj: bpy.types.Object) -> None:
        for index, material in enumerate(obj.data.materials):
            if material is None:
                continue
            key = strip_blender_suffix(material.name)
            canonical = self.materials.get(key)
            if canonical is None:
                material.name = key
                self.materials[key] = material
            elif material != canonical:
                obj.data.materials[index] = canonical

    def instance(
        self,
        name: str,
        location: tuple[float, float, float],
        rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
        scale: tuple[float, float, float] = (1.0, 1.0, 1.0),
        label: str | None = None,
        parent: bpy.types.Object | None = None,
    ) -> list[bpy.types.Object]:
        self.instance_counter += 1
        transform = (
            Matrix.Translation(location)
            @ Euler(rotation, "XYZ").to_matrix().to_4x4()
            @ Matrix.Diagonal((*scale, 1.0))
        )
        created: list[bpy.types.Object] = []
        for part_index, template in enumerate(self.load(name)):
            obj = template.copy()
            obj.data = template.data
            obj.name = (
                f"{label or name}_{self.instance_counter:04d}_{part_index:02d}"
            )
            self.output_collection.objects.link(obj)
            obj.hide_render = False
            obj.hide_viewport = False
            obj.matrix_world = transform @ template.matrix_world
            if parent is not None:
                keep_world = obj.matrix_world.copy()
                obj.parent = parent
                obj.matrix_world = keep_world
            created.append(obj)
        return created


def principled(material: bpy.types.Material) -> bpy.types.Node | None:
    if not material.use_nodes or material.node_tree is None:
        return None
    return material.node_tree.nodes.get("Principled BSDF")


def set_socket(node: bpy.types.Node | None, name: str, value: object) -> None:
    if node is not None and name in node.inputs:
        node.inputs[name].default_value = value


def make_material(
    name: str,
    color: tuple[float, float, float, float],
    roughness: float,
    metallic: float = 0.0,
    emission: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
    sheen: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    node = principled(material)
    set_socket(node, "Base Color", color)
    set_socket(node, "Roughness", roughness)
    set_socket(node, "Metallic", metallic)
    set_socket(node, "Coat Weight", 0.15 if metallic else 0.05)
    set_socket(node, "Sheen Weight", sheen)
    if emission is not None:
        set_socket(node, "Emission Color", emission)
        set_socket(node, "Emission Strength", emission_strength)
    return material


def tune_imported_materials(library: ModuleLibrary) -> None:
    tints: dict[str, tuple[float, float, float, float]] = {
        "MI_Plaster": (0.92, 0.67, 0.43, 1.0),
        "MI_UnevenBrick": (0.52, 0.62, 0.72, 1.0),
        "MI_Brick": (0.55, 0.61, 0.67, 1.0),
        "MI_RoundTiles": (0.88, 0.36, 0.22, 1.0),
        "MI_WoodTrim": (0.25, 0.16, 0.12, 1.0),
        "MI_WoodTrim_Wear": (0.38, 0.22, 0.15, 1.0),
        "MI_MetalOrnaments": (0.28, 0.20, 0.16, 1.0),
    }
    for name, tint in tints.items():
        node = principled(library.materials.get(name)) if name in library.materials else None
        set_socket(node, "Base Color", tint)
        if name == "MI_MetalOrnaments":
            set_socket(node, "Metallic", 0.72)
            set_socket(node, "Roughness", 0.38)
    glass = library.materials.get("MI_WindowGlass")
    node = principled(glass) if glass else None
    set_socket(node, "Base Color", (1.0, 0.36, 0.12, 1.0))
    set_socket(node, "Emission Color", (1.0, 0.13, 0.025, 1.0))
    set_socket(node, "Emission Strength", 4.2)
    set_socket(node, "Roughness", 0.28)


def create_root(name: str, collection: bpy.types.Collection) -> bpy.types.Object:
    root = bpy.data.objects.new(name, None)
    collection.objects.link(root)
    return root


def add_box(
    collection: bpy.types.Collection,
    name: str,
    location: tuple[float, float, float],
    size: tuple[float, float, float],
    material: bpy.types.Material,
    bevel: float = 0.08,
    bevel_segments: int = 3,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = tuple(value / 2 for value in size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(obj, collection)
    obj.data.materials.append(material)
    if bevel > 0:
        modifier = obj.modifiers.new("Soft carved edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = bevel_segments
        modifier.limit_method = "ANGLE"
        modifier.harden_normals = True
    if parent is not None:
        obj.parent = parent
    return obj


def add_uv_sphere(
    collection: bpy.types.Collection,
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    material: bpy.types.Material,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(obj, collection)
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    if parent is not None:
        obj.parent = parent
    return obj


def add_cylinder(
    collection: bpy.types.Collection,
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    material: bpy.types.Material,
    *,
    vertices: int = 48,
    bevel: float = 0.03,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    move_to_collection(obj, collection)
    obj.data.materials.append(material)
    if bevel > 0:
        modifier = obj.modifiers.new("Machined edge bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 4
        modifier.limit_method = "ANGLE"
        modifier.harden_normals = True
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    if parent is not None:
        obj.parent = parent
    return obj


def building(
    library: ModuleLibrary,
    parent: bpy.types.Object,
    label: str,
    x: float,
    y: float,
    width_modules: int,
    depth_modules: int,
    floors: int,
    roof: str,
    roof_z_offset: float = 0.78,
    wall: str = "Wall_Plaster_Window_Wide_Round",
    base_wall: str = "Wall_UnevenBrick_Window_Wide_Round",
    door: str = "Wall_Plaster_Door_RoundInset",
) -> None:
    width = width_modules * MODULE_WIDTH
    depth = depth_modules * MODULE_WIDTH
    for floor in range(floors):
        z = floor * WALL_HEIGHT
        for index in range(width_modules):
            px = x - width / 2 + MODULE_WIDTH / 2 + index * MODULE_WIDTH
            front_module = base_wall if floor == 0 else wall
            if floor == 0 and index == width_modules // 2:
                front_module = door
            library.instance(
                front_module,
                (px, y - depth / 2, z),
                label=f"{label}_front",
                parent=parent,
            )
            library.instance(
                base_wall if floor == 0 else wall,
                (px, y + depth / 2, z),
                rotation=(0, 0, math.pi),
                label=f"{label}_rear",
                parent=parent,
            )
        for index in range(depth_modules):
            py = y - depth / 2 + MODULE_WIDTH / 2 + index * MODULE_WIDTH
            side_module = base_wall if floor == 0 else wall
            library.instance(
                side_module,
                (x - width / 2, py, z),
                rotation=(0, 0, -math.pi / 2),
                label=f"{label}_left",
                parent=parent,
            )
            library.instance(
                side_module,
                (x + width / 2, py, z),
                rotation=(0, 0, math.pi / 2),
                label=f"{label}_right",
                parent=parent,
            )
    library.instance(
        roof,
        (x, y, floors * WALL_HEIGHT + roof_z_offset),
        label=f"{label}_roof",
        parent=parent,
    )


def create_island(
    collection: bpy.types.Collection,
    parent: bpy.types.Object,
    rock: bpy.types.Material,
    grass: bpy.types.Material,
) -> None:
    segments = 72
    rings = [
        (0.25, 26.0, 18.0),
        (-1.1, 25.2, 17.4),
        (-3.5, 21.2, 14.3),
        (-6.4, 15.0, 10.0),
    ]
    vertices: list[tuple[float, float, float]] = []
    uvs: list[tuple[float, float]] = []
    for ring_index, (z, radius_x, radius_y) in enumerate(rings):
        for index in range(segments):
            angle = index / segments * math.tau
            ripple = 1.0 + 0.045 * math.sin(angle * 5.0 + ring_index) + 0.025 * math.sin(angle * 11.0)
            vertices.append((math.cos(angle) * radius_x * ripple, 43 + math.sin(angle) * radius_y * ripple, z))
            uvs.append((index / segments * 4.0, ring_index / (len(rings) - 1) * 2.2))
    faces: list[tuple[int, int, int, int]] = []
    for ring_index in range(len(rings) - 1):
        for index in range(segments):
            current = ring_index * segments + index
            following = ring_index * segments + (index + 1) % segments
            lower_following = (ring_index + 1) * segments + (index + 1) % segments
            lower = (ring_index + 1) * segments + index
            faces.append((current, following, lower_following, lower))
    mesh = bpy.data.meshes.new("Sculpted island cliff mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            uv_layer.data[loop_index].uv = uvs[vertex_index]
            polygon.use_smooth = True
    cliff = bpy.data.objects.new("PBR sculpted island cliffs", mesh)
    collection.objects.link(cliff)
    cliff.data.materials.append(rock)
    cliff.parent = parent

    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=1, depth=0.34, location=(0, 43, 0.38))
    top = bpy.context.object
    top.name = "Moonharbor garden plateau"
    top.scale = (25.8, 17.8, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(top, collection)
    top.data.materials.append(grass)
    bevel = top.modifiers.new("Weathered soft rim", "BEVEL")
    bevel.width = 0.65
    bevel.segments = 4
    top.parent = parent


def create_trees(
    collection: bpy.types.Collection,
    parent: bpy.types.Object,
    trunk: bpy.types.Material,
    leaf: bpy.types.Material,
) -> None:
    positions = [
        (-19, 34, 0.8, 1.2), (-17, 47, 0.8, 1.0), (-13, 55, 0.8, 1.25),
        (14, 54, 0.8, 1.1), (19, 45, 0.8, 1.3), (18, 35, 0.8, 1.05),
        (-8, 31, 0.8, 0.95), (9, 32, 0.8, 1.0),
    ]
    for index, (x, y, z, scale) in enumerate(positions):
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.22 * scale, depth=2.8 * scale, location=(x, y, z + 1.4 * scale))
        tree_trunk = bpy.context.object
        tree_trunk.name = f"Carved tree trunk {index:02d}"
        move_to_collection(tree_trunk, collection)
        tree_trunk.data.materials.append(trunk)
        tree_trunk.parent = parent
        for crown_index, offset in enumerate(((-0.45, 0.0, 3.0), (0.36, 0.05, 3.2), (0.0, 0.15, 3.7))):
            add_uv_sphere(
                collection,
                f"Dense tree crown {index:02d}-{crown_index}",
                (x + offset[0] * scale, y + offset[1] * scale, z + offset[2] * scale),
                (1.25 * scale, 1.0 * scale, 1.35 * scale),
                leaf,
                parent,
            )


def create_city(
    library: ModuleLibrary,
    collection: bpy.types.Collection,
    parent: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> None:
    create_island(collection, parent, materials["rock"], materials["grass"])

    # Central romantic citadel: substantial silhouette, readable from the terrace,
    # and entirely made from authored textured modules.
    building(library, parent, "GrandKeep", 0, 45, 5, 7, 4, "Roof_RoundTiles_8x12")
    building(library, parent, "MoonSpire", 0, 46.5, 3, 3, 5, "Roof_Tower_RoundTiles")
    building(library, parent, "WestTower", -9, 42.5, 2, 2, 4, "Roof_Tower_RoundTiles")
    building(library, parent, "EastTower", 9, 42.5, 2, 2, 4, "Roof_Tower_RoundTiles")
    building(library, parent, "WestWing", -14, 47, 3, 4, 3, "Roof_RoundTiles_6x8")
    building(library, parent, "EastWing", 14, 47, 3, 4, 3, "Roof_RoundTiles_6x8")

    houses = [
        (-15.5, 35.2, 2, 3, 2, "Roof_RoundTiles_4x6"),
        (-10.4, 34.0, 2, 2, 2, "Roof_RoundTiles_4x4"),
        (-5.2, 34.2, 2, 3, 2, "Roof_RoundTiles_4x6"),
        (5.4, 34.3, 2, 3, 2, "Roof_RoundTiles_4x6"),
        (10.5, 34.0, 2, 2, 2, "Roof_RoundTiles_4x4"),
        (15.7, 35.3, 2, 3, 2, "Roof_RoundTiles_4x6"),
        (-19.2, 42.1, 2, 3, 2, "Roof_RoundTiles_4x6"),
        (19.2, 42.4, 2, 3, 2, "Roof_RoundTiles_4x6"),
        (-8.2, 56.0, 2, 3, 2, "Roof_RoundTiles_4x6"),
        (8.4, 56.1, 2, 3, 2, "Roof_RoundTiles_4x6"),
    ]
    for index, (x, y, width, depth, floors, roof) in enumerate(houses):
        building(library, parent, f"TownHouse{index:02d}", x, y, width, depth, floors, roof)
        library.instance("Prop_Chimney", (x + 0.7, y + 0.4, floors * WALL_HEIGHT + 1.0), scale=(0.72, 0.72, 0.72), label="Chimney", parent=parent)

    # Foreground city wall and a deep arch make the town feel inhabited rather
    # than like a set of disconnected doll houses.
    for index in range(22):
        x = -21 + index * 2
        if index in (10, 11):
            continue
        library.instance("Wall_UnevenBrick_Straight", (x, 29.2, 0.1), label="OuterWall", parent=parent)
    library.instance("Wall_Arch", (0, 29.15, 0.0), scale=(2.15, 1.0, 1.65), label="MoonGate", parent=parent)
    library.instance("Door_8_Round", (-0.02, 29.0, 0.15), scale=(0.9, 0.9, 1.45), label="MoonGateDoor", parent=parent)

    for x in (-22.5, 22.5):
        building(library, parent, f"WallTower{x:+.0f}", x, 30.3, 2, 2, 3, "Roof_Tower_RoundTiles")

    for name, x, y, z, rz, scale in [
        ("Prop_Vine1", -4.2, 38.0, 2.2, 0.0, 1.7),
        ("Prop_Vine4", 8.5, 40.4, 5.2, math.pi / 2, 1.5),
        ("Prop_Vine6", -13.8, 45.0, 4.4, -math.pi / 2, 1.4),
        ("Prop_Vine9", 15.2, 45.0, 3.4, math.pi / 2, 1.35),
    ]:
        library.instance(name, (x, y, z), rotation=(math.pi / 2, 0, rz), scale=(scale, scale, scale), label="Ivy", parent=parent)

    create_trees(collection, parent, materials["wood"], materials["leaf"])


def create_terrace(
    library: ModuleLibrary,
    collection: bpy.types.Collection,
    parent: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> None:
    for x_index in range(10):
        for y_index in range(7):
            library.instance(
                "Floor_Brick",
                (-9 + x_index * 2, -11 + y_index * 2, 0.15),
                label="TerracePaver",
                parent=parent,
            )
    for index in range(10):
        x = -9 + index * 2
        library.instance("Balcony_Simple_Straight", (x, 2.0, 0.2), label="FrontBalustrade", parent=parent)
    for side in (-10.0, 10.0):
        for index in range(6):
            y = -9.0 + index * 2
            library.instance(
                "Balcony_Simple_Straight",
                (side, y, 0.2),
                rotation=(0, 0, math.pi / 2 if side > 0 else -math.pi / 2),
                label="SideBalustrade",
                parent=parent,
            )

    # The lounge is the closest object to the camera, so it uses a layered,
    # high-segment construction instead of a single low-poly block. Individual
    # cushions, tufting, piping, arms and machined brass legs keep the silhouette
    # readable even when the camera is placed at seated eye level.
    add_box(
        collection,
        "Bench walnut lower frame",
        (0, -4.38, 0.82),
        (6.5, 1.28, 0.22),
        materials["lounge_wood"],
        0.09,
        bevel_segments=6,
        parent=parent,
    )
    add_box(
        collection,
        "Bench velvet upholstered base",
        (0, -4.32, 1.02),
        (6.22, 1.16, 0.24),
        materials["velvet_dark"],
        0.11,
        bevel_segments=6,
        parent=parent,
    )
    add_box(
        collection,
        "Bench walnut back rail",
        (0, -5.02, 1.72),
        (6.55, 0.18, 1.52),
        materials["lounge_wood"],
        0.075,
        bevel_segments=6,
        rotation=(math.radians(-6), 0, 0),
        parent=parent,
    )
    for x in (-2.7, 2.7):
        for y in (-4.75, -3.98):
            add_cylinder(
                collection,
                f"Bench machined brass leg {x:+.1f} {y:+.1f}",
                (x, y, 0.48),
                0.105,
                0.68,
                materials["metal"],
                vertices=64,
                bevel=0.025,
                parent=parent,
            )
            add_cylinder(
                collection,
                f"Bench brass foot {x:+.1f} {y:+.1f}",
                (x, y, 0.16),
                0.18,
                0.07,
                materials["metal"],
                vertices=64,
                bevel=0.018,
                parent=parent,
            )

    for index, x in enumerate((-2.08, 0.0, 2.08)):
        add_box(
            collection,
            f"Velvet seat cushion {index + 1}",
            (x, -4.21, 1.22),
            (1.92, 1.03, 0.27),
            materials["velvet"],
            0.17,
            bevel_segments=8,
            parent=parent,
        )
        add_box(
            collection,
            f"Velvet tufted back cushion {index + 1}",
            (x, -4.87, 1.82),
            (1.92, 0.31, 1.18),
            materials["velvet"],
            0.16,
            bevel_segments=8,
            rotation=(math.radians(-6), 0, 0),
            parent=parent,
        )
        for button_x in (x - 0.43, x + 0.43):
            for button_z in (1.6, 1.98):
                add_uv_sphere(
                    collection,
                    f"Velvet tuft button {index + 1}",
                    (button_x, -4.69, button_z),
                    (0.052, 0.028, 0.052),
                    materials["velvet_dark"],
                    parent,
                )

    for x in (-3.12, 3.12):
        add_box(
            collection,
            f"Bench rolled arm {x:+.1f}",
            (x, -4.25, 1.36),
            (0.34, 1.25, 0.48),
            materials["velvet_dark"],
            0.16,
            bevel_segments=8,
            parent=parent,
        )
        add_box(
            collection,
            f"Bench brass arm inlay {x:+.1f}",
            (x, -3.72, 1.37),
            (0.37, 0.045, 0.31),
            materials["metal"],
            0.022,
            bevel_segments=5,
            parent=parent,
        )

    # A framed woven rug and a small drinks table add believable domestic scale
    # without competing with the fireworks or the seated companion.
    add_box(collection, "Woven night carpet", (0, -7.2, 0.2), (5.4, 3.4, 0.07), materials["carpet"], 0.035, bevel_segments=4, parent=parent)
    for x in (-2.57, 2.57):
        add_box(collection, f"Carpet woven side border {x:+.1f}", (x, -7.2, 0.245), (0.12, 3.18, 0.018), materials["carpet_trim"], 0.02, bevel_segments=3, parent=parent)
    for y in (-8.77, -5.63):
        add_box(collection, f"Carpet woven end border {y:+.1f}", (0, y, 0.245), (5.02, 0.12, 0.018), materials["carpet_trim"], 0.02, bevel_segments=3, parent=parent)

    add_cylinder(collection, "Walnut drinks table top", (-4.15, -4.25, 1.02), 0.72, 0.11, materials["lounge_wood"], vertices=72, bevel=0.045, parent=parent)
    add_cylinder(collection, "Brass drinks table stem", (-4.15, -4.25, 0.61), 0.075, 0.76, materials["metal"], vertices=48, bevel=0.02, parent=parent)
    add_cylinder(collection, "Brass drinks table foot", (-4.15, -4.25, 0.24), 0.42, 0.075, materials["metal"], vertices=72, bevel=0.028, parent=parent)
    for x in (-4.34, -3.96):
        add_cylinder(collection, f"Two person glass stem {x:+.2f}", (x, -4.25, 1.17), 0.018, 0.22, materials["glass"], vertices=32, bevel=0.006, parent=parent)
        add_cylinder(collection, f"Two person glass bowl {x:+.2f}", (x, -4.25, 1.31), 0.095, 0.18, materials["glass"], vertices=48, bevel=0.012, parent=parent)

    for x in (-7.8, 7.8):
        add_cylinder(collection, f"Lantern carved stone plinth {x:+.1f}", (x, 0.75, 0.55), 0.42, 1.0, materials["stone_detail"], vertices=64, bevel=0.065, parent=parent)
        add_cylinder(collection, f"Lantern warm glass {x:+.1f}", (x, 0.75, 1.28), 0.23, 0.48, materials["lantern"], vertices=48, bevel=0.035, parent=parent)
        add_cylinder(collection, f"Lantern brass cap {x:+.1f}", (x, 0.75, 1.58), 0.33, 0.13, materials["metal"], vertices=64, bevel=0.028, parent=parent)


def texture_node(
    nodes: bpy.types.Nodes,
    path: Path,
    *,
    non_color: bool = False,
) -> bpy.types.Node:
    node = nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(str(path), check_existing=True)
    if non_color:
        node.image.colorspace_settings.name = "Non-Color"
    return node


def setup_character_material(
    material: bpy.types.Material,
    texture_dir: Path,
    prefix: str,
    *,
    opacity: bool = False,
) -> None:
    material.name = f"Companion {prefix.removeprefix('f022_')} PBR"
    material.use_nodes = True
    node_tree = material.node_tree
    if node_tree is None:
        raise RuntimeError(f"Unable to create material nodes for {material.name}")
    nodes = node_tree.nodes
    links = node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    set_socket(shader, "Roughness", 0.56)
    set_socket(shader, "IOR", 1.45)
    set_socket(shader, "Specular IOR Level", 0.34)
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    color = texture_node(nodes, texture_dir / f"{prefix}_color.tga")
    links.new(color.outputs["Color"], shader.inputs["Base Color"])
    if opacity:
        links.new(color.outputs["Alpha"], shader.inputs["Alpha"])
        material.surface_render_method = "DITHERED"
        material.use_backface_culling = False
        return

    normal = texture_node(nodes, texture_dir / f"{prefix}_normal.tga", non_color=True)
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.inputs["Strength"].default_value = 0.72
    links.new(normal.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])
    specular = texture_node(nodes, texture_dir / f"{prefix}_specular.tga", non_color=True)
    invert = nodes.new("ShaderNodeInvert")
    links.new(specular.outputs["Color"], invert.inputs["Color"])
    links.new(invert.outputs["Color"], shader.inputs["Roughness"])


def retarget_seated_pose(
    character: bpy.types.Object,
    reference: bpy.types.Object,
    frame: int = 600,
) -> None:
    """Retarget a Rocketbox seated rest pose while preserving the character rig."""
    bpy.context.scene.frame_set(frame)
    body_bones = [
        "Bip01 Pelvis",
        "Bip01 Spine",
        "Bip01 Spine1",
        "Bip01 Spine2",
        "Bip01 Neck",
        "Bip01 Head",
        "Bip01 L Clavicle",
        "Bip01 L UpperArm",
        "Bip01 L Forearm",
        "Bip01 L Hand",
        "Bip01 R Clavicle",
        "Bip01 R UpperArm",
        "Bip01 R Forearm",
        "Bip01 R Hand",
        "Bip01 L Thigh",
        "Bip01 L Calf",
        "Bip01 L Foot",
        "Bip01 L Toe0",
        "Bip01 R Thigh",
        "Bip01 R Calf",
        "Bip01 R Foot",
        "Bip01 R Toe0",
    ]
    for name in body_bones:
        target_pose = character.pose.bones[name]
        target_rest = character.data.bones[name]
        source_pose = reference.pose.bones[name]
        target_relative = (
            target_rest.parent.matrix_local.inverted() @ target_rest.matrix_local
            if target_rest.parent
            else target_rest.matrix_local
        )
        source_relative = (
            source_pose.parent.matrix.inverted() @ source_pose.matrix
            if source_pose.parent
            else source_pose.matrix
        )
        target_pose.rotation_mode = "QUATERNION"
        target_pose.rotation_quaternion = (
            target_relative.to_quaternion().inverted()
            @ source_relative.to_quaternion()
        )


def create_companion_idle(armature: bpy.types.Object) -> None:
    """Create a compact looping seated idle with a small skyward reaction."""
    animated_bones = [
        "Bip01 Pelvis",
        "Bip01 Spine",
        "Bip01 Spine1",
        "Bip01 Spine2",
        "Bip01 Neck",
        "Bip01 Head",
        "Bip01 L Clavicle",
        "Bip01 L UpperArm",
        "Bip01 L Forearm",
        "Bip01 L Hand",
        "Bip01 R Clavicle",
        "Bip01 R UpperArm",
        "Bip01 R Forearm",
        "Bip01 R Hand",
        "Bip01 L Thigh",
        "Bip01 L Calf",
        "Bip01 L Foot",
        "Bip01 R Thigh",
        "Bip01 R Calf",
        "Bip01 R Foot",
    ]
    base = {
        name: armature.pose.bones[name].rotation_quaternion.copy()
        for name in animated_bones
    }
    armature.animation_data_create()
    action = bpy.data.actions.new("Companion seated idle and sky reaction")
    armature.animation_data.action = action
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 240
    scene.render.fps = 30

    poses = [
        (1, 0.0, 0.0, 0.0),
        (48, 0.012, -0.018, 0.0),
        (96, 0.0, 0.018, 0.0),
        (138, -0.008, 0.052, 0.026),
        (186, 0.01, 0.018, 0.012),
        (240, 0.0, 0.0, 0.0),
    ]
    for frame, breath, head_turn, sky_tilt in poses:
        scene.frame_set(frame)
        for name in animated_bones:
            armature.pose.bones[name].rotation_quaternion = base[name].copy()
        armature.pose.bones["Bip01 Spine2"].rotation_quaternion @= Quaternion((1, 0, 0), breath)
        armature.pose.bones["Bip01 Neck"].rotation_quaternion @= Quaternion((0, 1, 0), head_turn * 0.42)
        armature.pose.bones["Bip01 Head"].rotation_quaternion @= (
            Quaternion((0, 1, 0), head_turn)
            @ Quaternion((1, 0, 0), sky_tilt)
        )
        armature.pose.bones["Bip01 L Clavicle"].rotation_quaternion @= Quaternion((0, 0, 1), breath * 0.22)
        armature.pose.bones["Bip01 R Clavicle"].rotation_quaternion @= Quaternion((0, 0, -1), breath * 0.22)
        for name in animated_bones:
            armature.pose.bones[name].keyframe_insert(
                data_path="rotation_quaternion",
                frame=frame,
                group=name,
            )
    scene.frame_set(1)


def create_companion(
    collection: bpy.types.Collection,
    parent: bpy.types.Object,
    character_path: Path,
    texture_dir: Path,
    pose_path: Path,
) -> tuple[int, int]:
    """Import and animate a production Rocketbox character for the terrace."""
    before_character = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(character_path), use_anim=False)
    imported_character = [obj for obj in bpy.data.objects if obj not in before_character]
    armature = next(obj for obj in imported_character if obj.type == "ARMATURE")
    mesh = max(
        (obj for obj in imported_character if obj.type == "MESH"),
        key=lambda obj: len(obj.data.vertices),
    )

    for material in mesh.data.materials:
        if material.name == "f022_body":
            setup_character_material(material, texture_dir, "f022_body")
        elif material.name == "f022_head":
            setup_character_material(material, texture_dir, "f022_head")
        elif material.name == "f022_opacity":
            setup_character_material(material, texture_dir, "f022_opacity", opacity=True)

    before_pose = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(pose_path))
    imported_pose = [obj for obj in bpy.data.objects if obj not in before_pose]
    pose_armature = next(obj for obj in imported_pose if obj.type == "ARMATURE")
    retarget_seated_pose(armature, pose_armature)

    # The reference FBX carries a full capture action. It is useful only for
    # deriving the seated pose and would otherwise be exported beside our
    # compact idle loop, adding thousands of unused samples to the GLB.
    for obj in imported_pose:
        if obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    if armature.animation_data:
        armature.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    create_companion_idle(armature)

    # She occupies the neighbouring cushion and faces the fireworks. The compact
    # runtime rig retains authored anatomy, fingers, hair cards and 2K PBR maps,
    # while the exported loop supplies breathing and a subtle skyward glance.
    armature.location = (0.9, -4.28, 1.45)
    armature.rotation_euler[2] = math.pi
    bpy.context.view_layer.update()
    armature.name = "Companion rig - Rocketbox 81 bones"
    mesh.name = "Seated companion - Rocketbox LOD0 skinned"
    mesh.data.name = "Seated companion skinned mesh"
    # The facial source ships hundreds of blend targets. No runtime expression
    # controller uses them in this seated wide shot, while their sparse deltas
    # and normals add roughly 19 MB. Keep the full LOD0 surface, 2K maps and
    # 81-bone skin, but strip the dormant morph library from this scene asset.
    if mesh.data.shape_keys:
        bpy.ops.object.select_all(action="DESELECT")
        mesh.select_set(True)
        bpy.context.view_layer.objects.active = mesh
        bpy.ops.object.shape_key_remove(all=True, apply_mix=False)
    for polygon in mesh.data.polygons:
        polygon.use_smooth = True
    move_to_collection(armature, collection)
    move_to_collection(mesh, collection)
    rig_world = armature.matrix_world.copy()
    armature.parent = parent
    armature.matrix_world = rig_world

    for obj in imported_character:
        if obj not in (mesh, armature) and obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)

    mesh.data.calc_loop_triangles()
    return len(mesh.data.vertices), len(mesh.data.loop_triangles)


def add_preview_light(
    collection: bpy.types.Collection,
    name: str,
    light_type: str,
    location: tuple[float, float, float],
    color: tuple[float, float, float],
    energy: float,
    size: float = 5.0,
) -> bpy.types.Object:
    data = bpy.data.lights.new(name, light_type)
    data.color = color
    data.energy = energy
    if hasattr(data, "shape"):
        data.shape = "DISK"
    if hasattr(data, "size"):
        data.size = size
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = location
    return obj


def aim_at(obj: bpy.types.Object, target: Iterable[float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_preview(path: Path, collection: bpy.types.Collection) -> Path:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = bpy.data.worlds.new("Preview moon sky") if scene.world is None else scene.world
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.005, 0.009, 0.032, 1)
    background.inputs["Strength"].default_value = 0.42

    camera_data = bpy.data.cameras.new("Preview first-person camera")
    camera = bpy.data.objects.new("Preview first-person camera", camera_data)
    collection.objects.link(camera)
    camera.location = (-0.72, -3.65, 1.82)
    camera_data.lens = 29
    camera_data.sensor_width = 36
    aim_at(camera, (0, 35, 10.5))
    scene.camera = camera

    moon = add_preview_light(collection, "Preview moon", "AREA", (-24, 15, 36), (0.45, 0.62, 1.0), 3800, 12)
    aim_at(moon, (0, 42, 5))
    warm = add_preview_light(collection, "Preview city warmth", "AREA", (12, 26, 18), (1.0, 0.26, 0.08), 2300, 10)
    aim_at(warm, (0, 43, 6))
    fill = add_preview_light(collection, "Preview terrace fill", "AREA", (-6, -2, 8), (0.42, 0.58, 1.0), 1450, 7)
    aim_at(fill, (0, -4, 1.2))
    bpy.ops.render.render(write_still=True)

    companion_path = path.with_name(f"{path.stem}-companion{path.suffix}")
    camera.location = (-2.35, -1.8, 2.25)
    camera_data.lens = 58
    aim_at(camera, (0.9, -4.25, 1.45))
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.filepath = str(companion_path)
    bpy.ops.render.render(write_still=True)
    return companion_path


def select_hierarchy(root: bpy.types.Object) -> None:
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)


def export_glb(path: Path, root: bpy.types.Object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    select_hierarchy(root)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_animations=True,
        export_frame_range=True,
        # Preserve the authored keyframes instead of sampling every transform
        # on all 81 bones for all 240 frames. The latter adds ~19 MB of static
        # animation data without changing the motion.
        export_force_sampling=False,
        export_skins=True,
        export_materials="EXPORT",
        export_image_format="WEBP",
        export_image_quality=88,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_cameras=False,
        export_lights=False,
    )


def main() -> None:
    args = parse_args()
    if not args.kit.exists():
        raise FileNotFoundError(args.kit)
    for path in (args.companion, args.companion_textures, args.companion_pose):
        if not path.exists():
            raise FileNotFoundError(path)
    clear_scene()
    scene_collection = bpy.context.scene.collection
    templates = bpy.data.collections.new("SOURCE TEMPLATES - NOT EXPORTED")
    hero_collection = bpy.data.collections.new("Hero world")
    preview_collection = bpy.data.collections.new("Preview only")
    scene_collection.children.link(templates)
    scene_collection.children.link(hero_collection)
    scene_collection.children.link(preview_collection)
    root = create_root("Moonharbor Hero World", hero_collection)
    library = ModuleLibrary(args.kit, templates, hero_collection)

    # Preload the materials used by custom geometry, then tune the shared art
    # direction once for every instance in the scene.
    for module in (
        "Wall_Plaster_Window_Wide_Round",
        "Wall_UnevenBrick_Window_Wide_Round",
        "Roof_RoundTiles_8x12",
        "Floor_Brick",
        "Floor_WoodDark",
        "Prop_MetalFence_Ornament",
        "Prop_Brick1",
    ):
        library.load(module)
    tune_imported_materials(library)

    lounge_glass = make_material(
        "Smoked crystal glass",
        (0.42, 0.55, 0.68, 1.0),
        0.12,
    )
    glass_shader = principled(lounge_glass)
    set_socket(glass_shader, "Transmission Weight", 0.72)
    set_socket(glass_shader, "IOR", 1.46)
    lounge_glass.surface_render_method = "DITHERED"

    materials = {
        "rock": library.materials.get("MI_UnevenBrick") or make_material("Moon rock", (0.24, 0.32, 0.42, 1), 0.92),
        "wood": library.materials.get("MI_WoodTrim") or make_material("Dark oak", (0.14, 0.07, 0.04, 1), 0.78),
        "grass": make_material("Moonlit garden grass", (0.055, 0.18, 0.13, 1), 0.93),
        "leaf": make_material("Deep emerald foliage", (0.025, 0.15, 0.11, 1), 0.88, sheen=0.08),
        "metal": make_material("Aged romantic brass", (0.22, 0.12, 0.055, 1), 0.34, 0.78),
        "lounge_wood": make_material("Hand finished walnut", (0.075, 0.024, 0.011, 1), 0.34, sheen=0.03),
        "velvet": make_material("Berry moon velvet", (0.15, 0.012, 0.052, 1), 0.72, sheen=0.58),
        "velvet_dark": make_material("Deep berry velvet piping", (0.045, 0.003, 0.014, 1), 0.76, sheen=0.46),
        "carpet": make_material("Midnight woven carpet", (0.07, 0.035, 0.12, 1), 0.94, sheen=0.2),
        "carpet_trim": make_material("Woven carpet border", (0.32, 0.13, 0.21, 1), 0.9, sheen=0.16),
        "stone_detail": make_material("Fine cut blue limestone", (0.15, 0.19, 0.25, 1), 0.82),
        "glass": lounge_glass,
        "lantern": make_material("Warm lantern glass", (1.0, 0.22, 0.045, 1), 0.26, emission=(1.0, 0.06, 0.01, 1), emission_strength=5.2),
    }

    create_city(library, hero_collection, root, materials)
    create_terrace(library, hero_collection, root, materials)
    companion_vertices, companion_triangles = create_companion(
        hero_collection,
        root,
        args.companion,
        args.companion_textures,
        args.companion_pose,
    )
    tune_imported_materials(library)

    companion_preview: Path | None = None
    if args.preview:
        args.preview.parent.mkdir(parents=True, exist_ok=True)
        companion_preview = render_preview(args.preview, preview_collection)
    export_glb(args.output, root)
    print(f"HERO_ASSET={args.output}")
    print(f"HERO_ASSET_BYTES={args.output.stat().st_size}")
    print(f"COMPANION_VERTICES={companion_vertices}")
    print(f"COMPANION_TRIANGLES={companion_triangles}")
    if args.preview:
        print(f"HERO_PREVIEW={args.preview}")
    if companion_preview:
        print(f"COMPANION_PREVIEW={companion_preview}")


if __name__ == "__main__":
    main()
