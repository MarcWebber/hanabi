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
from mathutils import Euler, Matrix, Vector


WALL_HEIGHT = 3.123
MODULE_WIDTH = 2.0
KIT_DEFAULT = Path(
    "/private/tmp/medieval-megakit/Medieval Village MegaKit[Standard]/glTF"
)


def parse_args() -> argparse.Namespace:
    extra = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--kit", type=Path, default=KIT_DEFAULT)
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
        modifier.segments = 3
        modifier.limit_method = "ANGLE"
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

    # Substantial, softened timber bench with separate velvet cushions.
    add_box(collection, "Bench seat", (0, -4.35, 1.0), (6.5, 1.35, 0.28), materials["wood"], 0.12, parent=parent)
    add_box(collection, "Bench back", (0, -4.98, 1.72), (6.5, 0.25, 1.45), materials["wood"], 0.11, rotation=(math.radians(-6), 0, 0), parent=parent)
    for x in (-2.65, 2.65):
        add_box(collection, f"Bench leg {x:+.1f}", (x, -4.35, 0.53), (0.34, 0.92, 0.94), materials["metal"], 0.07, parent=parent)
    for x in (-1.55, 0.0, 1.55):
        add_box(collection, f"Velvet cushion {x:+.1f}", (x, -4.28, 1.19), (1.42, 1.06, 0.2), materials["velvet"], 0.18, parent=parent)

    # Carpet and small foreground props break up tiling in the closest metre.
    add_box(collection, "Woven night carpet", (0, -7.2, 0.2), (4.8, 3.2, 0.08), materials["carpet"], 0.08, parent=parent)
    for x in (-7.8, 7.8):
        add_box(collection, f"Lantern plinth {x:+.1f}", (x, 0.75, 0.55), (0.62, 0.62, 1.0), materials["rock"], 0.08, parent=parent)
        add_box(collection, f"Lantern glass {x:+.1f}", (x, 0.75, 1.28), (0.36, 0.36, 0.48), materials["lantern"], 0.07, parent=parent)
        add_box(collection, f"Lantern cap {x:+.1f}", (x, 0.75, 1.58), (0.48, 0.48, 0.13), materials["metal"], 0.05, parent=parent)


def add_ellipsoid(
    collection: bpy.types.Collection,
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    material: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=48,
        ring_count=32,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(obj, collection)
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.parent = parent
    return obj


def add_limb(
    collection: bpy.types.Collection,
    name: str,
    start: tuple[float, float, float],
    end: tuple[float, float, float],
    start_radius: float,
    end_radius: float,
    material: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    start_vector = Vector(start)
    end_vector = Vector(end)
    direction = end_vector - start_vector
    bpy.ops.mesh.primitive_cone_add(
        vertices=32,
        radius1=end_radius,
        radius2=start_radius,
        depth=direction.length,
        location=(start_vector + end_vector) / 2,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    move_to_collection(obj, collection)
    obj.data.materials.append(material)
    bevel = obj.modifiers.new("Anatomical softness", "BEVEL")
    bevel.width = min(start_radius, end_radius) * 0.34
    bevel.segments = 3
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.parent = parent
    return obj


def add_fabric_shell(
    collection: bpy.types.Collection,
    name: str,
    rings: list[tuple[float, float, float, float]],
    material: bpy.types.Material,
    parent: bpy.types.Object,
    segments: int = 40,
) -> bpy.types.Object:
    """Create a smooth elliptical cloth volume from z/y/radius rings."""
    center_x = 0.9
    vertices: list[tuple[float, float, float]] = []
    for z, center_y, radius_x, radius_y in rings:
        for index in range(segments):
            angle = index / segments * math.tau
            vertices.append(
                (
                    center_x + math.cos(angle) * radius_x,
                    center_y + math.sin(angle) * radius_y,
                    z,
                )
            )
    faces: list[tuple[int, int, int, int]] = []
    for ring_index in range(len(rings) - 1):
        for index in range(segments):
            current = ring_index * segments + index
            following = ring_index * segments + (index + 1) % segments
            faces.append(
                (
                    current,
                    following,
                    following + segments,
                    current + segments,
                )
            )
    mesh = bpy.data.meshes.new(f"{name} mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    subdivision = obj.modifiers.new("Tailored cloth surface", "SUBSURF")
    subdivision.levels = 1
    subdivision.render_levels = 1
    solidify = obj.modifiers.new("Tailored cloth thickness", "SOLIDIFY")
    solidify.thickness = 0.018
    obj.parent = parent
    return obj


def add_dress_train(
    collection: bpy.types.Collection,
    parent: bpy.types.Object,
    material: bpy.types.Material,
) -> None:
    segments_x = 26
    segments_y = 24
    vertices: list[tuple[float, float, float]] = []
    for row in range(segments_y + 1):
        v = row / segments_y
        center_y = -4.12 + v * 1.18
        center_z = 1.29 - v * 0.33 + math.sin(v * math.pi) * 0.045
        width = 0.32 + v * 0.2
        for column in range(segments_x + 1):
            u = column / segments_x * 2 - 1
            vertices.append(
                (
                    0.9 + u * width,
                    center_y,
                    center_z - (u * u) * 0.045,
                )
            )
    faces: list[tuple[int, int, int, int]] = []
    stride = segments_x + 1
    for row in range(segments_y):
        for column in range(segments_x):
            index = row * stride + column
            faces.append((index, index + 1, index + stride + 1, index + stride))
    mesh = bpy.data.meshes.new("Moon velvet lap train mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    train = bpy.data.objects.new("Moon velvet lap train", mesh)
    collection.objects.link(train)
    train.data.materials.append(material)
    for polygon in train.data.polygons:
        polygon.use_smooth = True
    subdivision = train.modifiers.new("Soft fabric folds", "SUBSURF")
    subdivision.levels = 2
    subdivision.render_levels = 2
    solidify = train.modifiers.new("Fabric thickness", "SOLIDIFY")
    solidify.thickness = 0.035
    train.parent = parent

    # Front fall hides the mechanical knee/ankle area and reads as a coherent
    # floor-length gown from every camera angle.
    add_fabric_shell(
        collection,
        "Moon velvet front drape",
        [
            (0.98, -2.95, 0.52, 0.13),
            (0.72, -2.96, 0.5, 0.14),
            (0.38, -2.98, 0.47, 0.16),
            (0.12, -3.02, 0.43, 0.18),
        ],
        material,
        parent,
    )


def add_hair_curve(
    collection: bpy.types.Collection,
    name: str,
    points: list[tuple[float, float, float]],
    material: bpy.types.Material,
    parent: bpy.types.Object,
    thickness: float,
) -> bpy.types.Object:
    curve = bpy.data.curves.new(f"{name} curve", type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 3
    curve.bevel_depth = thickness
    curve.bevel_resolution = 4
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    curve.materials.append(material)
    obj.parent = parent
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    return bpy.context.object


def create_companion(
    collection: bpy.types.Collection,
    parent: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> None:
    """Create a bespoke high-density seated companion for the close foreground."""
    companion = create_root("Seated stargazer companion", collection)
    companion.parent = parent
    skin = materials["skin"]
    hair = materials["hair"]
    dress = materials["velvet"]
    trim = materials["metal"]

    # Tailored torso, waist and skirt use continuous subdivided surfaces instead
    # of stacked capsules. The fitted silhouette is intentionally stylized rather
    # than uncanny-realistic, matching the authored medieval city.
    add_fabric_shell(
        collection,
        "Tailored velvet bodice",
        [
            (1.2, -4.22, 0.3, 0.23),
            (1.42, -4.23, 0.28, 0.21),
            (1.72, -4.23, 0.35, 0.23),
            (1.9, -4.22, 0.39, 0.24),
        ],
        dress,
        companion,
    )
    add_fabric_shell(
        collection,
        "Seated velvet skirt",
        [
            (1.26, -4.2, 0.32, 0.28),
            (1.1, -4.18, 0.43, 0.34),
            (0.94, -4.15, 0.49, 0.39),
        ],
        dress,
        companion,
    )
    add_dress_train(collection, companion, dress)

    # Neck, head and a subtly protruding face sit inside a separate soft hair
    # volume, giving the model a proper profile even though she is mostly viewed
    # from the neighbouring seat.
    add_ellipsoid(collection, "Companion neck", (0.9, -4.2, 1.94), (0.095, 0.09, 0.15), skin, companion)
    add_ellipsoid(collection, "Companion face", (0.9, -4.13, 2.14), (0.22, 0.21, 0.28), skin, companion)
    add_ellipsoid(collection, "Sculpted hair volume", (0.9, -4.29, 2.18), (0.255, 0.245, 0.305), hair, companion)
    add_ellipsoid(collection, "Soft face plane", (0.9, -3.985, 2.135), (0.18, 0.06, 0.215), skin, companion)
    add_ellipsoid(collection, "Small profile nose", (0.9, -3.905, 2.125), (0.038, 0.045, 0.04), skin, companion)
    add_ellipsoid(collection, "Hair bun", (0.9, -4.52, 2.25), (0.155, 0.13, 0.16), hair, companion)

    # Bent arms terminate in hands resting naturally on the lap.
    arm_points = [
        ("L", (0.56, -4.18, 1.82), (0.48, -3.92, 1.5), (0.7, -3.48, 1.17)),
        ("R", (1.24, -4.18, 1.82), (1.32, -3.92, 1.5), (1.1, -3.48, 1.17)),
    ]
    for side, shoulder, elbow, wrist in arm_points:
        add_ellipsoid(collection, f"{side} soft shoulder", shoulder, (0.16, 0.15, 0.18), dress, companion)
        add_limb(collection, f"{side} velvet upper arm", shoulder, elbow, 0.13, 0.11, dress, companion)
        add_limb(collection, f"{side} velvet lower arm", elbow, wrist, 0.105, 0.075, dress, companion)
        add_ellipsoid(collection, f"{side} hand", wrist, (0.085, 0.12, 0.075), skin, companion)

    # Readable facial features are deliberately restrained at this viewing
    # distance. Highlights catch moonlight without turning into glowing dots.
    for x in (0.835, 0.965):
        add_ellipsoid(collection, f"Eye {x:.2f}", (x, -3.915, 2.17), (0.031, 0.011, 0.022), materials["eye"], companion)
        add_ellipsoid(collection, f"Eye glint {x:.2f}", (x - 0.006, -3.901, 2.179), (0.008, 0.005, 0.008), materials["eye_glint"], companion)
    add_ellipsoid(collection, "Rose lips", (0.9, -3.913, 2.065), (0.045, 0.01, 0.014), materials["lips"], companion)

    # Individual wavy locks provide the close-up detail missing from the old
    # low-poly sprite-like head. They are converted to real mesh for glTF.
    for index in range(22):
        angle = index / 21 * math.pi
        start_x = 0.9 + math.cos(angle) * 0.225
        start_z = 2.22 + math.sin(angle) * 0.16
        side = (index / 21 - 0.5) * 2
        length = 0.44 + 0.26 * (1 - abs(side))
        add_hair_curve(
            collection,
            f"Wavy hair lock {index:02d}",
            [
                (start_x, -4.27, start_z),
                (start_x + side * 0.035, -4.35, start_z - length * 0.33),
                (start_x - side * 0.05, -4.34, start_z - length * 0.7),
                (start_x + side * 0.04, -4.29, start_z - length),
            ],
            hair,
            companion,
            0.014 + (index % 3) * 0.003,
        )
    for index, x in enumerate((0.72, 0.79, 1.01, 1.08)):
        add_hair_curve(
            collection,
            f"Face framing lock {index:02d}",
            [
                (x, -4.03, 2.32),
                (x + (0.9 - x) * 0.18, -3.94, 2.24),
                (x + (0.9 - x) * 0.08, -3.95, 2.05),
                (x, -4.02, 1.91),
            ],
            hair,
            companion,
            0.013,
        )

    # Fine metallic accents catch each firework hue and make the costume feel
    # designed rather than assembled from generic primitives.
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.3,
        minor_radius=0.025,
        major_segments=48,
        minor_segments=10,
        location=(0.9, -4.22, 1.39),
    )
    belt = bpy.context.object
    belt.name = "Filigree waist belt"
    belt.scale.y = 0.78
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(belt, collection)
    belt.data.materials.append(trim)
    belt.parent = companion
    add_ellipsoid(collection, "Star hair pin", (1.1, -4.08, 2.35), (0.045, 0.02, 0.045), trim, companion)


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
        export_apply=True,
        export_animations=False,
        export_materials="EXPORT",
        export_image_format="WEBP",
        export_image_quality=88,
        export_cameras=False,
        export_lights=False,
    )


def main() -> None:
    args = parse_args()
    if not args.kit.exists():
        raise FileNotFoundError(args.kit)
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

    materials = {
        "rock": library.materials.get("MI_UnevenBrick") or make_material("Moon rock", (0.24, 0.32, 0.42, 1), 0.92),
        "wood": library.materials.get("MI_WoodTrim") or make_material("Dark oak", (0.14, 0.07, 0.04, 1), 0.78),
        "grass": make_material("Moonlit garden grass", (0.055, 0.18, 0.13, 1), 0.93),
        "leaf": make_material("Deep emerald foliage", (0.025, 0.15, 0.11, 1), 0.88, sheen=0.08),
        "metal": make_material("Aged romantic brass", (0.22, 0.12, 0.055, 1), 0.34, 0.78),
        "velvet": make_material("Berry moon velvet", (0.18, 0.018, 0.065, 1), 0.66, sheen=0.42),
        "carpet": make_material("Midnight woven carpet", (0.07, 0.035, 0.12, 1), 0.94, sheen=0.2),
        "lantern": make_material("Warm lantern glass", (1.0, 0.22, 0.045, 1), 0.26, emission=(1.0, 0.06, 0.01, 1), emission_strength=5.2),
        "skin": make_material("Warm stylized skin", (0.72, 0.35, 0.24, 1), 0.62, sheen=0.08),
        "hair": make_material("Midnight auburn hair", (0.055, 0.014, 0.028, 1), 0.42, sheen=0.28),
        "eye": make_material("Deep violet eyes", (0.018, 0.012, 0.04, 1), 0.3),
        "eye_glint": make_material("Soft eye glint", (0.68, 0.78, 1.0, 1), 0.2),
        "lips": make_material("Rose lips", (0.48, 0.045, 0.095, 1), 0.56, sheen=0.18),
    }

    create_city(library, hero_collection, root, materials)
    create_terrace(library, hero_collection, root, materials)
    create_companion(hero_collection, root, materials)
    tune_imported_materials(library)

    companion_preview: Path | None = None
    if args.preview:
        args.preview.parent.mkdir(parents=True, exist_ok=True)
        companion_preview = render_preview(args.preview, preview_collection)
    export_glb(args.output, root)
    print(f"HERO_ASSET={args.output}")
    print(f"HERO_ASSET_BYTES={args.output.stat().st_size}")
    if args.preview:
        print(f"HERO_PREVIEW={args.preview}")
    if companion_preview:
        print(f"COMPANION_PREVIEW={companion_preview}")


if __name__ == "__main__":
    main()
